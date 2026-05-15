import { FFmpegWasmService } from '../services/FFmpegWasmService';

// Browser-side video processing utilities
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

interface ProgressCallback {
  (progress: number, stage?: string): void;
}

/**
 * Get video metadata using browser HTML video element
 */
export const getVideoMetadata = async (videoFile: File): Promise<VideoMetadata> => {
  // Create a video element to get basic metadata
  const videoEl = document.createElement('video');
  videoEl.src = URL.createObjectURL(videoFile);
  
  const metadata = await new Promise<VideoMetadata>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout loading video metadata'));
    }, 10000); // 10 second timeout

    videoEl.onloadedmetadata = () => {
      clearTimeout(timeout);
      resolve({
        duration: videoEl.duration,
        width: videoEl.videoWidth || 1920,
        height: videoEl.videoHeight || 1080,
        fps: 30 // Default FPS
      });
    };
    
    videoEl.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load video metadata - invalid or corrupted video file'));
    };
  });
  
  URL.revokeObjectURL(videoEl.src);
  return metadata;
};

/**
 * Legacy function: Now delegates to processVideoWithBeatsDirect.
 * Previously this uploaded videos. Now it runs in the browser.
 */
export const processVideoWithBeats = async (
  videos: { file: File; id: string }[],
  beatMarkers: number[],
  projectName: string = 'Video Processing',
  onProgress?: ProgressCallback
): Promise<string> => {
  throw new Error('processVideoWithBeats is deprecated without an audio file in browser mode. Use processVideoWithBeatsDirect.');
};

export const trimVideo = async (): Promise<string> => { throw new Error('Not implemented for WASM'); };
export const concatenateVideos = async (): Promise<string> => { throw new Error('Not implemented for WASM'); };
export const processLargeVideo = async (): Promise<string> => { throw new Error('Not implemented for WASM'); };
export async function processVideo(): Promise<string> { throw new Error('Not implemented for WASM'); }
export async function generateThumbnail(): Promise<string> { throw new Error('Not implemented for WASM'); }

export async function cleanupFFmpeg(): Promise<void> {
  await FFmpegWasmService.getInstance().terminate();
}

export function getMemoryInfo(): { total: number; free: number } {
  return { total: Infinity, free: Infinity };
}

export function hasEnoughMemory(): boolean {
  return true;
}

export async function tryFreeMemory(): Promise<void> {}

/**
 * Direct video processing using FFmpeg.wasm in the browser.
 */
export const processVideoWithBeatsDirect = async (
  videos: { file: File; id: string }[],
  beatMarkers: number[],
  audioFile: File,
  projectName: string = 'Video Processing',
  quality: 'fast' | 'balanced' | 'high' = 'balanced',
  onProgress?: ProgressCallback
): Promise<string> => {
  console.log('🚀 WASM DIRECT: Starting local video processing');

  try {
    // Validate inputs
    if (!videos || videos.length === 0) throw new Error('No video files provided');
    if (!beatMarkers || beatMarkers.length < 2) throw new Error('Need at least 2 beat markers');
    if (!audioFile) throw new Error('Audio file is required');

    // Attach metadata
    const videosWithMetadata = [];
    for (let i = 0; i < videos.length; i++) {
      onProgress?.(0.01, `Analyzing metadata for ${videos[i].file.name}...`);
      const meta = await getVideoMetadata(videos[i].file);
      videosWithMetadata.push({
        ...videos[i],
        duration: meta.duration,
        width: meta.width,
        height: meta.height
      });
    }

    const outputUrl = await FFmpegWasmService.getInstance().processVideoWithBeatsBrowser(
      videosWithMetadata,
      beatMarkers,
      audioFile,
      quality,
      onProgress,
      (log) => console.log('[FFmpeg Log]:', log)
    );

    console.log('🚀 WASM DIRECT: Processing completed locally', { outputUrl });
    return outputUrl;

  } catch (error) {
    console.error('🚀 WASM DIRECT: Processing failed', error);
    throw error;
  }
};