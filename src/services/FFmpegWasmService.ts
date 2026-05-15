import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { v4 as uuidv4 } from 'uuid';

export type LogCallback = (msg: string) => void;
export type ProgressCallback = (progress: number) => void;

class FFmpegWasmService {
  private static instance: FFmpegWasmService;
  private ffmpeg: FFmpeg;
  private isLoaded: boolean = false;
  private isProcessing: boolean = false;

  private constructor() {
    this.ffmpeg = new FFmpeg();
  }

  public static getInstance(): FFmpegWasmService {
    if (!FFmpegWasmService.instance) {
      FFmpegWasmService.instance = new FFmpegWasmService();
    }
    return FFmpegWasmService.instance;
  }

  public getFFmpeg(): FFmpeg {
    return this.ffmpeg;
  }

  public async load(onProgress?: ProgressCallback, onLog?: LogCallback): Promise<void> {
    if (this.isLoaded) return;
    
    // Attach logging and progress early
    if (onLog) {
      this.ffmpeg.on('log', ({ message }) => onLog(message));
    }
    
    if (onProgress) {
      this.ffmpeg.on('progress', ({ progress }) => {
        // progress is 0 to 1
        onProgress(progress);
      });
    }

    const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';
    
    // Determine if SharedArrayBuffer is available. If not, fallback to single threaded core.
    const isSharedArrayBufferSupported = typeof SharedArrayBuffer !== 'undefined';
    
    let coreURL, wasmURL, workerURL;
    
    if (isSharedArrayBufferSupported) {
      coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript');
    } else {
      const singleBaseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      coreURL = await toBlobURL(`${singleBaseURL}/ffmpeg-core.js`, 'text/javascript');
      wasmURL = await toBlobURL(`${singleBaseURL}/ffmpeg-core.wasm`, 'application/wasm');
    }

    await this.ffmpeg.load({
      coreURL,
      wasmURL,
      workerURL,
    });
    
    this.isLoaded = true;
  }

  public async terminate(): Promise<void> {
    if (this.isLoaded && !this.isProcessing) {
      this.ffmpeg.terminate();
      this.isLoaded = false;
    }
  }

  public async writeFile(fileName: string, fileData: File | Blob | Uint8Array): Promise<void> {
    if (fileData instanceof Uint8Array) {
      await this.ffmpeg.writeFile(fileName, fileData);
    } else {
      const data = await fetchFile(fileData);
      await this.ffmpeg.writeFile(fileName, data);
    }
  }

  public async readFile(fileName: string): Promise<Uint8Array> {
    const data = await this.ffmpeg.readFile(fileName);
    return data as Uint8Array;
  }
  
  public async deleteFile(fileName: string): Promise<void> {
    try {
      await this.ffmpeg.deleteFile(fileName);
    } catch (e) {
      console.warn(`Could not delete file ${fileName} from VFS`, e);
    }
  }

  /**
   * Browser-based processing logic that replaces the server's process-direct logic
   */
  public async processVideoWithBeatsBrowser(
    videos: { file: File; id: string; duration?: number; width?: number; height?: number }[],
    beatMarkers: number[],
    audioFile: File,
    quality: 'fast' | 'balanced' | 'high' = 'balanced',
    onProgress?: (progress: number, stage?: string) => void,
    onLog?: (msg: string) => void
  ): Promise<string> {
    if (!this.isLoaded) {
      onProgress?.(0, 'Loading FFmpeg Core...');
      await this.load((p) => onProgress?.(p * 0.1, 'Loading FFmpeg Core...'), onLog);
    }

    if (this.isProcessing) {
      throw new Error('FFmpeg is already processing a task. Please wait.');
    }

    this.isProcessing = true;
    
    // Use smaller chunks for progress distribution
    // 0-10% Setup & VFS Loading
    // 10-80% Video Segment Processing
    // 80-90% Concatenation
    // 90-100% Audio merging

    try {
      onProgress?.(0.1, 'Writing files to memory...');
      
      const audioFileName = `audio_${uuidv4()}.m4a`;
      await this.writeFile(audioFileName, audioFile);

      // Write video files to VFS
      const vfsVideoMap = new Map<string, string>();
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const vfsName = `input_${i}_${uuidv4()}.mp4`;
        await this.writeFile(vfsName, video.file);
        vfsVideoMap.set(video.id, vfsName);
      }

      // Generate Segments
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
          video: videos[videoIndex],
          vfsName: vfsVideoMap.get(videos[videoIndex].id)!,
          startTime: 0,
          duration: beatMarkers[i + 1] - beatMarkers[i],
          index: i
        });
      }

      // Quality settings
      const qualitySettings = {
        fast: { preset: 'ultrafast', crf: '28', resolution: '854:480' },
        balanced: { preset: 'superfast', crf: '24', resolution: '1280:720' },
        high: { preset: 'veryfast', crf: '20', resolution: '1920:1080' }
      };
      const settings = qualitySettings[quality] || qualitySettings.balanced;

      const targetWidth = videos[0].width || 1280;
      const targetHeight = videos[0].height || 720;
      const w = Math.floor(targetWidth / 2) * 2;
      const h = Math.floor(targetHeight / 2) * 2;

      const segmentPaths: string[] = [];

      // Process segments
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const outName = `segment_${i}.mp4`;
        segmentPaths.push(outName);

        const stageProgress = 0.1 + (0.7 * (i / segments.length));
        onProgress?.(stageProgress, `Rendering segment ${i + 1}/${segments.length}...`);

        // FFmpeg.wasm does not have 'setStartTime' methods, we use raw args
        // ffmpeg -ss startTime -t duration -i input.mp4 -vf scale=... -preset ... output.mp4
        
        await this.ffmpeg.exec([
          '-ss', seg.startTime.toString(),
          '-t', seg.duration.toString(),
          '-i', seg.vfsName,
          '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', settings.preset,
          '-crf', settings.crf,
          '-pix_fmt', 'yuv420p',
          outName
        ]);
      }

      // Concat
      onProgress?.(0.8, 'Stitching segments together...');
      const concatTxtName = 'concat.txt';
      const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
      
      // Write concat.txt to VFS
      // ffmpeg.wasm expects Uint8Array for writeFile
      const enc = new TextEncoder();
      await this.ffmpeg.writeFile(concatTxtName, enc.encode(concatContent));

      const videoOnlyName = 'video_only.mp4';
      await this.ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', concatTxtName,
        '-c', 'copy',
        videoOnlyName
      ]);

      // Add Audio
      onProgress?.(0.9, 'Applying audio track...');
      const finalOutputName = `final_output_${uuidv4()}.mp4`;
      await this.ffmpeg.exec([
        '-i', videoOnlyName,
        '-i', audioFileName,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        finalOutputName
      ]);

      onProgress?.(0.95, 'Finalizing output...');
      
      // Read Output
      const outputData = await this.readFile(finalOutputName);
      
      // Cleanup VFS
      onProgress?.(0.98, 'Cleaning up...');
      await this.deleteFile(audioFileName);
      for (const v of vfsVideoMap.values()) await this.deleteFile(v);
      for (const s of segmentPaths) await this.deleteFile(s);
      await this.deleteFile(concatTxtName);
      await this.deleteFile(videoOnlyName);
      await this.deleteFile(finalOutputName);

      const blob = new Blob([outputData.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      onProgress?.(1.0, 'Complete!');
      this.isProcessing = false;
      return url;

    } catch (e) {
      this.isProcessing = false;
      console.error('Browser FFmpeg processing failed', e);
      throw e;
    }
  }
}

export const ffmpegWasmService = FFmpegWasmService.getInstance();
