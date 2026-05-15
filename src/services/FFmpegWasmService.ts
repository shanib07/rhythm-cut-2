'use client';

/**
 * FFmpegWasmService — WorkerBridge
 *
 * Spawns a Web Worker for all FFmpeg processing so the main thread
 * (and therefore React / the browser UI) is never blocked.
 *
 * Usage:
 *   const url = await FFmpegWasmService.getInstance()
 *     .processVideoWithBeatsBrowser(videos, beats, audio, quality, onProgress);
 */
export class FFmpegWasmService {
  private static instance: FFmpegWasmService;
  private isProcessing = false;

  public static getInstance(): FFmpegWasmService {
    if (!FFmpegWasmService.instance) {
      FFmpegWasmService.instance = new FFmpegWasmService();
    }
    return FFmpegWasmService.instance;
  }

  public async terminate(): Promise<void> {
    // Nothing persistent to terminate in the worker-bridge model
  }

  /**
   * Process videos with beat markers entirely in a background Web Worker.
   * Returns an object URL the caller can play/download.
   */
  public async processVideoWithBeatsBrowser(
    videos: { file: File; id: string; duration?: number; width?: number; height?: number }[],
    beatMarkers: number[],
    audioFile: File,
    quality: 'fast' | 'balanced' | 'high' = 'balanced',
    onProgress?: (progress: number, stage?: string) => void,
    onLog?: (msg: string) => void
  ): Promise<string> {
    if (this.isProcessing) {
      throw new Error('Already processing. Please wait for the current export to finish.');
    }

    this.isProcessing = true;

    try {
      // ── Convert Files to ArrayBuffers (transferable, zero-copy to worker) ──
      onProgress?.(0.01, 'Reading files...');

      const videoBuffers = await Promise.all(
        videos.map(v => v.file.arrayBuffer())
      );
      const audioBuffer = await audioFile.arrayBuffer();

      // ── Build metadata for the worker ──────────────────────────────────────
      const videoMeta = videos.map((v, i) => ({
        buffer: videoBuffers[i],
        id: v.id,
        width: v.width   ?? 1280,
        height: v.height ?? 720,
        duration: v.duration ?? 0,
      }));

      onProgress?.(0.03, 'Starting background worker...');

      // ── Spawn worker and await result ───────────────────────────────────────
      const outputBuffer = await this.runInWorker(
        videoMeta,
        audioBuffer,
        beatMarkers,
        quality,
        onProgress,
        onLog
      );

      const blob = new Blob([outputBuffer], { type: 'video/mp4' });
      return URL.createObjectURL(blob);

    } finally {
      this.isProcessing = false;
    }
  }

  private runInWorker(
    videos: { buffer: ArrayBuffer; id: string; width: number; height: number; duration: number }[],
    audio: ArrayBuffer,
    beatMarkers: number[],
    quality: string,
    onProgress?: (progress: number, stage?: string) => void,
    onLog?: (msg: string) => void
  ): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const worker = new Worker('/ffmpeg.worker.js', { type: 'module' });

      worker.onmessage = (e) => {
        const { type, ...data } = e.data;

        switch (type) {
          case 'progress':
            onProgress?.(data.progress, data.stage);
            break;
          case 'log':
            onLog?.(data.message);
            break;
          case 'complete':
            worker.terminate();
            resolve(data.buffer as ArrayBuffer);
            break;
          case 'error':
            worker.terminate();
            reject(new Error(data.message));
            break;
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error(err.message || 'Worker crashed unexpectedly'));
      };

      // Transfer ArrayBuffers to worker (zero-copy) ──────────────────────────
      const transferables: Transferable[] = [
        audio,
        ...videos.map(v => v.buffer),
      ];

      worker.postMessage(
        { type: 'process', videos, audio, beatMarkers, quality },
        transferables
      );
    });
  }
}
