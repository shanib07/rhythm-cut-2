'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

export type ProgressCallback = (progress: number, stage?: string) => void;
export type LogCallback = (msg: string) => void;

/**
 * FFmpegWasmService — Singleton that manages a properly-configured FFmpeg instance.
 *
 * KEY FIX: Provides `classWorkerURL` to ffmpeg.load() so the @ffmpeg/ffmpeg
 * internal worker loads via blob URL instead of cross-origin CDN (which fails
 * with COEP headers). This enables the multi-threaded core to work properly,
 * meaning FFmpeg runs in its OWN background threads — the main thread stays free.
 *
 * Also uses a single-pass filter_complex command instead of N separate encodes.
 */
export class FFmpegWasmService {
  private static instance: FFmpegWasmService;
  private ffmpeg: FFmpeg | null = null;
  private isLoaded = false;
  private isProcessing = false;

  public static getInstance(): FFmpegWasmService {
    if (!FFmpegWasmService.instance) {
      FFmpegWasmService.instance = new FFmpegWasmService();
    }
    return FFmpegWasmService.instance;
  }

  public async terminate(): Promise<void> {
    if (this.ffmpeg && this.isLoaded && !this.isProcessing) {
      this.ffmpeg.terminate();
      this.ffmpeg = null;
      this.isLoaded = false;
    }
  }

  /**
   * Load FFmpeg with all required blob URLs including the critical classWorkerURL.
   */
  private async ensureLoaded(onProgress?: ProgressCallback, onLog?: LogCallback): Promise<FFmpeg> {
    if (this.ffmpeg && this.isLoaded) return this.ffmpeg;

    onProgress?.(0.02, 'Loading FFmpeg engine...');
    this.ffmpeg = new FFmpeg();

    if (onLog) {
      this.ffmpeg.on('log', ({ message }) => onLog(message));
    }

    const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
    let coreURL: string, wasmURL: string, workerURL: string | undefined, classWorkerURL: string;

    if (hasSharedBuffer) {
      // Multi-threaded core — FFmpeg runs in background threads, UI stays responsive
      const coreBase = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';
      coreURL   = await toBlobURL(`${coreBase}/ffmpeg-core.js`,        'text/javascript');
      wasmURL   = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`,      'application/wasm');
      workerURL = await toBlobURL(`${coreBase}/ffmpeg-core.worker.js`, 'text/javascript');
    } else {
      // Fallback single-threaded core
      const coreBase = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      coreURL = await toBlobURL(`${coreBase}/ffmpeg-core.js`,   'text/javascript');
      wasmURL = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm');
    }

    // THIS is the critical fix: load the @ffmpeg/ffmpeg internal worker as a blob URL
    // Without this, it tries to load from unpkg.com cross-origin, which COEP blocks
    classWorkerURL = await toBlobURL(
      'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js',
      'text/javascript'
    );

    await this.ffmpeg.load({ coreURL, wasmURL, workerURL, classWorkerURL });
    this.isLoaded = true;
    onProgress?.(0.08, 'FFmpeg engine ready.');
    return this.ffmpeg;
  }

  /**
   * Process videos with beat markers using a single-pass filter_complex.
   * FFmpeg runs in background threads — UI stays responsive.
   */
  public async processVideoWithBeatsBrowser(
    videos: { file: File; id: string; duration?: number; width?: number; height?: number }[],
    beatMarkers: number[],
    audioFile: File,
    quality: 'fast' | 'balanced' | 'high' = 'balanced',
    onProgress?: ProgressCallback,
    onLog?: LogCallback
  ): Promise<string> {
    if (this.isProcessing) {
      throw new Error('Already processing. Please wait for the current export to finish.');
    }
    this.isProcessing = true;

    try {
      const ffmpeg = await this.ensureLoaded(onProgress, onLog);

      // Attach real-time progress from FFmpeg's internal encoder
      const progressHandler = ({ progress }: { progress: number }) => {
        // Map FFmpeg's 0-1 progress to our 15%-95% range (the encoding phase)
        onProgress?.(0.15 + progress * 0.80, `Encoding... ${Math.round(progress * 100)}%`);
      };
      ffmpeg.on('progress', progressHandler);

      // ── 1. Write files to virtual filesystem ────────────────────────────
      onProgress?.(0.09, 'Loading files into memory...');

      const vfsNames: string[] = [];
      for (let i = 0; i < videos.length; i++) {
        const name = `input_${i}.mp4`;
        vfsNames.push(name);
        const data = await fetchFile(videos[i].file);
        await ffmpeg.writeFile(name, data);
        onProgress?.(0.09 + 0.04 * ((i + 1) / videos.length), `Loaded video ${i + 1}/${videos.length}`);
      }

      await ffmpeg.writeFile('audio_in.m4a', await fetchFile(audioFile));
      onProgress?.(0.14, 'Building edit plan...');

      // ── 2. Build segment map ────────────────────────────────────────────
      const segments = this.buildSegments(videos, beatMarkers);

      // ── 3. Build single-pass filter_complex ────────────────────────────
      const baseW = Math.floor((videos[0].width  ?? 1280) / 2) * 2;
      const baseH = Math.floor((videos[0].height ?? 720)  / 2) * 2;

      const qualityMap = {
        fast:     { preset: 'ultrafast', crf: '28' },
        balanced: { preset: 'superfast', crf: '24' },
        high:     { preset: 'veryfast',  crf: '20' },
      };
      const { preset, crf } = qualityMap[quality] || qualityMap.balanced;

      // Count how many times each video is used (for split filters)
      const usageCount = new Array(videos.length).fill(0);
      segments.forEach(s => usageCount[s.videoIndex]++);
      const usageTracker = new Array(videos.length).fill(0);

      const filterLines: string[] = [];
      const splitLabels: string[][] = [];

      // Split filters for videos used more than once
      for (let i = 0; i < videos.length; i++) {
        const count = usageCount[i];
        if (count <= 1) {
          splitLabels.push([`[${i}:v]`]);
        } else {
          const labels = Array.from({ length: count }, (_, k) => `[v${i}s${k}]`);
          filterLines.push(`[${i}:v]split=${count}${labels.join('')}`);
          splitLabels.push(labels);
        }
      }

      // Trim + scale each segment
      const segLabels: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const vi = seg.videoIndex;
        const useN = usageTracker[vi]++;
        const srcLabel = usageCount[vi] <= 1 ? `[${vi}:v]` : splitLabels[vi][useN];
        const outLabel = `[seg${i}]`;
        segLabels.push(outLabel);

        filterLines.push(
          `${srcLabel}trim=start=${seg.startTime}:duration=${seg.duration},` +
          `setpts=PTS-STARTPTS,` +
          `scale=${baseW}:${baseH}:force_original_aspect_ratio=decrease,` +
          `pad=${baseW}:${baseH}:(ow-iw)/2:(oh-ih)/2,` +
          `fps=30` +
          outLabel
        );
      }

      // Concat all segments
      filterLines.push(`${segLabels.join('')}concat=n=${segments.length}:v=1:a=0[outv]`);
      const filterComplex = filterLines.join(';');

      // ── 4. Build FFmpeg command ─────────────────────────────────────────
      const inputArgs: string[] = [];
      for (const name of vfsNames) {
        inputArgs.push('-i', name);
      }
      inputArgs.push('-i', 'audio_in.m4a');
      const audioIdx = videos.length;

      const args = [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', `${audioIdx}:a`,
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

      onProgress?.(0.15, `Rendering ${segments.length} beat-synced segments...`);

      // ── 5. Execute (runs in background threads via core-mt) ────────────
      await ffmpeg.exec(args);

      // ── 6. Read output & cleanup ───────────────────────────────────────
      ffmpeg.off('progress', progressHandler);
      onProgress?.(0.96, 'Reading output...');

      const outputData = await ffmpeg.readFile('output.mp4') as Uint8Array;

      onProgress?.(0.98, 'Cleaning up...');
      for (const name of vfsNames) {
        try { await ffmpeg.deleteFile(name); } catch (_) {}
      }
      try { await ffmpeg.deleteFile('audio_in.m4a'); } catch (_) {}
      try { await ffmpeg.deleteFile('output.mp4');   } catch (_) {}

      const blob = new Blob([outputData], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      onProgress?.(1.0, 'Complete!');
      return url;

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Deterministic segment builder — same algorithm as the server version.
   */
  private buildSegments(
    videos: { id: string }[],
    beatMarkers: number[]
  ): { videoIndex: number; startTime: number; duration: number }[] {
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
}
