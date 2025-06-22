import { FFmpeg } from '@ffmpeg/ffmpeg';

export interface VideoSegment {
  id: string;
  startTime: number;
  endTime: number;
  videoFile: File;
  videoStartTime: number;
  videoEndTime: number;
}

export interface ProcessingProgress {
  progress: number;
  stage: string;
  message?: string;
}

export class FFmpegVideoProcessor {
  private ffmpeg: FFmpeg | null = null;
  private isLoaded = false;
  private audioFile: File | null = null;
  private videoFiles: Map<string, File> = new Map();
  private progressCallback?: (progress: ProcessingProgress) => void;

  constructor() {
    // FFmpeg will be loaded dynamically
  }

  async initialize(): Promise<void> {
    if (!this.isLoaded) {
      this.progressCallback?.({
        progress: 0,
        stage: 'loading',
        message: 'Loading FFmpeg...'
      });
      
      try {
        // Dynamic import to avoid webpack issues
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const { toBlobURL } = await import('@ffmpeg/util');
        
        this.ffmpeg = new FFmpeg();
        
        // Set up event listeners
        this.ffmpeg.on('log', ({ message }: { message: string }) => {
          console.log(message);
        });

        this.ffmpeg.on('progress', ({ progress }: { progress: number }) => {
          if (this.progressCallback) {
            this.progressCallback({
              progress,
              stage: 'processing',
              message: `Processing: ${Math.round(progress * 100)}%`
            });
          }
        });

        const baseURL = '/ffmpeg';
        
        await this.ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        
        this.isLoaded = true;
        
        this.progressCallback?.({
          progress: 1,
          stage: 'ready',
          message: 'FFmpeg loaded successfully'
        });
      } catch (error) {
        console.error('Error loading FFmpeg:', error);
        throw new Error('Failed to load FFmpeg. Please refresh the page and try again.');
      }
    }
  }

  setProgressCallback(callback: (progress: ProcessingProgress) => void): void {
    this.progressCallback = callback;
  }

  async setAudioFile(file: File): Promise<void> {
    if (!this.ffmpeg) {
      await this.initialize();
    }
    
    if (!this.ffmpeg) {
      throw new Error('Failed to initialize FFmpeg');
    }
    
    this.audioFile = file;
    const { fetchFile } = await import('@ffmpeg/util');
    const audioData = await fetchFile(file);
    await this.ffmpeg.writeFile('input_audio.mp3', audioData);
  }

  async addVideoFile(id: string, file: File): Promise<void> {
    if (!this.ffmpeg) {
      await this.initialize();
    }
    
    if (!this.ffmpeg) {
      throw new Error('Failed to initialize FFmpeg');
    }
    
    this.videoFiles.set(id, file);
    const { fetchFile } = await import('@ffmpeg/util');
    const videoData = await fetchFile(file);
    await this.ffmpeg.writeFile(`video_${id}.mp4`, videoData);
  }

  async createTimeline(segments: VideoSegment[]): Promise<string> {
    await this.initialize();

    if (!this.ffmpeg) {
      throw new Error('Failed to initialize FFmpeg');
    }

    if (!this.audioFile) {
      throw new Error('Audio file is required');
    }

    this.progressCallback?.({
      progress: 0,
      stage: 'timeline',
      message: 'Creating video timeline...'
    });

    // Create filter complex for video concatenation and synchronization
    const filterParts: string[] = [];
    const inputArgs: string[] = ['-i', 'input_audio.mp3'];

    // Add all video inputs
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      inputArgs.push('-i', `video_${segment.id}.mp4`);
      
      const duration = segment.endTime - segment.startTime;
      const videoDuration = segment.videoEndTime - segment.videoStartTime;
      
      // Trim the video to the required duration (input index is i+1 because audio is at index 0)
      filterParts.push(
        `[${i + 1}:v]trim=start=${segment.videoStartTime}:duration=${Math.min(duration, videoDuration)},setpts=PTS-STARTPTS[v${i}]`
      );
    }

    // Concatenate all video segments
    const videoInputs = segments.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${videoInputs}concat=n=${segments.length}:v=1:a=0[outv]`);

    const filterComplex = filterParts.join(';');

    // Build FFmpeg command
    const command = [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '0:a', // Use audio from the first input (our custom audio)
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'fast',
      '-crf', '23',
      'output.mp4'
    ];

    await this.ffmpeg.exec(command);

    this.progressCallback?.({
      progress: 1,
      stage: 'complete',
      message: 'Timeline created successfully'
    });

    return 'output.mp4';
  }

  async exportVideo(segments: VideoSegment[]): Promise<Blob> {
    const outputFileName = await this.createTimeline(segments);
    
    if (!this.ffmpeg) {
      throw new Error('Failed to initialize FFmpeg');
    }
    
    this.progressCallback?.({
      progress: 0.9,
      stage: 'export',
      message: 'Preparing export...'
    });

    const data = await this.ffmpeg.readFile(outputFileName);
    const blob = new Blob([data], { type: 'video/mp4' });

    this.progressCallback?.({
      progress: 1,
      stage: 'complete',
      message: 'Export completed successfully'
    });

    return blob;
  }

  async createPreviewVideo(segments: VideoSegment[], maxDuration = 30): Promise<string> {
    await this.initialize();

    if (!this.ffmpeg) {
      throw new Error('Failed to initialize FFmpeg');
    }

    if (!this.audioFile || segments.length === 0) {
      throw new Error('Audio file and video segments are required');
    }

    this.progressCallback?.({
      progress: 0,
      stage: 'preview',
      message: 'Creating preview...'
    });

    // Create a shorter preview version
    const previewSegments = segments.slice(0, Math.min(segments.length, 3)); // Limit to first 3 segments
    const totalDuration = Math.min(
      previewSegments.reduce((sum, seg) => sum + (seg.endTime - seg.startTime), 0),
      maxDuration
    );

    const filterParts: string[] = [];
    const inputArgs: string[] = ['-i', 'input_audio.mp3'];

    for (let i = 0; i < previewSegments.length; i++) {
      const segment = previewSegments[i];
      inputArgs.push('-i', `video_${segment.id}.mp4`);
      
      const duration = Math.min(segment.endTime - segment.startTime, totalDuration / previewSegments.length);
      
      filterParts.push(
        `[${i + 1}:v]trim=start=${segment.videoStartTime}:duration=${duration},setpts=PTS-STARTPTS,scale=640:360[v${i}]`
      );
    }

    const videoInputs = previewSegments.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${videoInputs}concat=n=${previewSegments.length}:v=1:a=0[outv]`);

    const filterComplex = filterParts.join(';');

    const command = [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '0:a',
      '-t', totalDuration.toString(),
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'ultrafast',
      '-crf', '28',
      'preview.mp4'
    ];

    await this.ffmpeg.exec(command);

    this.progressCallback?.({
      progress: 1,
      stage: 'complete',
      message: 'Preview created successfully'
    });

    return 'preview.mp4';
  }

  async getPreviewUrl(): Promise<string> {
    if (!this.ffmpeg) {
      throw new Error('FFmpeg is not initialized');
    }
    
    const data = await this.ffmpeg.readFile('preview.mp4');
    const blob = new Blob([data], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  }

  async cleanup(): Promise<void> {
    if (!this.ffmpeg) return;
    
    // Clean up temporary files
    try {
      await this.ffmpeg.deleteFile('input_audio.mp3');
      await this.ffmpeg.deleteFile('output.mp4');
      await this.ffmpeg.deleteFile('preview.mp4');
      
      for (const [id] of this.videoFiles) {
        try {
          await this.ffmpeg.deleteFile(`video_${id}.mp4`);
        } catch (e) {
          // File might not exist
        }
      }
    } catch (e) {
      // Files might not exist
    }
  }

  dispose(): void {
    this.cleanup();
    // FFmpeg doesn't have a dispose method in the new API
  }
} 