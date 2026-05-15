/**
 * FFmpeg Web Worker — runs entirely off the main thread.
 * Communicates via postMessage:
 *   IN:  { type: 'process', videos: [{buffer, id, width, height, duration}], audio: ArrayBuffer, beatMarkers, quality }
 *   OUT: { type: 'progress', progress, stage }
 *        { type: 'log', message }
 *        { type: 'complete', buffer }
 *        { type: 'error', message }
 */

import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js';
import { toBlobURL } from 'https://unpkg.com/@ffmpeg/util@0.12.2/dist/esm/index.js';

let ffmpeg = null;
let isLoaded = false;

function postProgress(progress, stage) {
  self.postMessage({ type: 'progress', progress, stage });
}

function postLog(message) {
  self.postMessage({ type: 'log', message });
}

async function loadFFmpeg() {
  if (isLoaded) return;
  postProgress(0, 'Loading FFmpeg engine...');

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => postLog(message));
  ffmpeg.on('progress', ({ progress }) => {
    // Internal FFmpeg progress (0-1), we map it within the processing stage
    postProgress(0.1 + progress * 0.85, `Processing... ${Math.round(progress * 100)}%`);
  });

  const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
  let coreURL, wasmURL, workerURL;

  if (hasSharedBuffer) {
    const base = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';
    coreURL   = await toBlobURL(`${base}/ffmpeg-core.js`,        'text/javascript');
    wasmURL   = await toBlobURL(`${base}/ffmpeg-core.wasm`,      'application/wasm');
    workerURL = await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript');
  } else {
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    coreURL  = await toBlobURL(`${base}/ffmpeg-core.js`,   'text/javascript');
    wasmURL  = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
  }

  await ffmpeg.load({ coreURL, wasmURL, workerURL });
  isLoaded = true;
}

/**
 * Build a deterministic segment list (same algorithm as server + main thread)
 */
function buildSegments(videos, beatMarkers) {
  const segments = [];
  let lastVideoIndex = -1;
  for (let i = 0; i < beatMarkers.length - 1; i++) {
    const seed = i + beatMarkers.length + videos.length;
    let rand = Math.sin(seed * 12.9898) * 43758.5453;
    rand = rand - Math.floor(rand);
    let videoIndex = Math.floor(rand * videos.length);
    if (videos.length > 1 && videoIndex === lastVideoIndex) {
      videoIndex = (videoIndex + 1) % videos.length;
    }
    lastVideoIndex = videoIndex;
    segments.push({
      videoIndex,
      startTime: 0,
      duration: beatMarkers[i + 1] - beatMarkers[i],
    });
  }
  return segments;
}

async function processVideo({ videos, audio, beatMarkers, quality }) {
  await loadFFmpeg();
  postProgress(0.08, 'Writing files to memory...');

  const qualitySettings = {
    fast:     { preset: 'ultrafast', crf: '28' },
    balanced: { preset: 'superfast', crf: '24' },
    high:     { preset: 'veryfast',  crf: '20' },
  };
  const { preset, crf } = qualitySettings[quality] || qualitySettings.balanced;

  // ── 1. Write unique video files to VFS ─────────────────────────────────────
  const vfsNames = [];
  for (let i = 0; i < videos.length; i++) {
    const name = `input_${i}.mp4`;
    vfsNames.push(name);
    await ffmpeg.writeFile(name, new Uint8Array(videos[i].buffer));
    postProgress(0.08 + 0.04 * (i / videos.length), `Loading video ${i + 1}/${videos.length}...`);
  }

  // ── 2. Write audio to VFS ───────────────────────────────────────────────────
  await ffmpeg.writeFile('audio_in.m4a', new Uint8Array(audio));
  postProgress(0.12, 'Building edit plan...');

  // ── 3. Build segments ──────────────────────────────────────────────────────
  const segments = buildSegments(videos, beatMarkers);
  const totalDuration = beatMarkers[beatMarkers.length - 1] - beatMarkers[0];

  // Target resolution — use first video's dimensions (even-numbered)
  const baseW = Math.floor((videos[0].width  || 1280) / 2) * 2;
  const baseH = Math.floor((videos[0].height || 720)  / 2) * 2;

  // ── 4. Build single-pass filter_complex ───────────────────────────────────
  // Count how many times each input video is used so we know how many splits we need
  const usageCount = new Array(videos.length).fill(0);
  segments.forEach(s => usageCount[s.videoIndex]++);
  const usageIndex = new Array(videos.length).fill(0);

  // Input args: one per unique video + audio last
  const inputArgs = [];
  for (let i = 0; i < videos.length; i++) {
    inputArgs.push('-i', vfsNames[i]);
  }
  inputArgs.push('-i', 'audio_in.m4a');
  const audioInputIndex = videos.length;

  // Split filters for inputs used more than once
  const filterLines = [];
  const splitLabels = []; // splitLabels[videoIndex][useN] = label string like [v0s2]

  for (let i = 0; i < videos.length; i++) {
    const count = usageCount[i];
    if (count === 1) {
      splitLabels.push([`[${i}:v]`]); // Direct reference, no split needed
    } else {
      // e.g. [0:v]split=3[v0s0][v0s1][v0s2]
      const labels = Array.from({ length: count }, (_, k) => `[v${i}s${k}]`);
      filterLines.push(`[${i}:v]split=${count}${labels.join('')}`);
      splitLabels.push(labels);
    }
  }

  // Trim + scale filter for each segment
  const segLabels = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const vi  = seg.videoIndex;
    const useN = usageIndex[vi]++;
    // Pop a split label (or direct reference for count=1)
    const srcLabel = usageCount[vi] === 1 ? `[${vi}:v]` : splitLabels[vi][useN];
    const outLabel = `[seg${i}v]`;
    segLabels.push(outLabel);

    filterLines.push(
      `${srcLabel}trim=start=${seg.startTime}:duration=${seg.duration},` +
      `setpts=PTS-STARTPTS,` +
      `scale=${baseW}:${baseH}:force_original_aspect_ratio=decrease,` +
      `pad=${baseW}:${baseH}:(ow-iw)/2:(oh-ih)/2,` +
      `fps=30` +
      `${outLabel}`
    );
  }

  // Concat video segments
  const concatIn  = segLabels.join('');
  filterLines.push(`${concatIn}concat=n=${segments.length}:v=1:a=0[outv]`);

  const filterComplex = filterLines.join(';');

  postProgress(0.13, `Rendering ${segments.length} beat-synced segments in one pass...`);

  // ── 5. Execute single FFmpeg command ──────────────────────────────────────
  const args = [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', `${audioInputIndex}:a`,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', crf,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    'output.mp4',
  ];

  await ffmpeg.exec(args);

  postProgress(0.97, 'Reading output...');
  const outputData = await ffmpeg.readFile('output.mp4');

  // ── 6. Cleanup VFS ────────────────────────────────────────────────────────
  postProgress(0.99, 'Cleaning up...');
  for (const name of vfsNames) {
    try { await ffmpeg.deleteFile(name); } catch (_) {}
  }
  try { await ffmpeg.deleteFile('audio_in.m4a'); } catch (_) {}
  try { await ffmpeg.deleteFile('output.mp4');   } catch (_) {}

  postProgress(1.0, 'Complete!');
  // Transfer the buffer back to main thread (zero-copy)
  const buffer = outputData.buffer;
  self.postMessage({ type: 'complete', buffer }, [buffer]);
}

// ── Message handler ────────────────────────────────────────────────────────
self.onmessage = async (e) => {
  const { type, ...payload } = e.data;
  if (type === 'process') {
    try {
      await processVideo(payload);
    } catch (err) {
      self.postMessage({ type: 'error', message: err?.message || String(err) });
    }
  }
};
