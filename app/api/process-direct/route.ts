import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

interface VideoInput {
  id: string;
  url: string;
  duration: number;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  console.log('🎬 PROCESS: Starting video processing', {
    timestamp: new Date().toISOString()
  });

  try {
    // Check if FFmpeg is available
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg.ffprobe((err, data) => {
          if (err) {
            console.error('FFmpeg check failed:', err);
            reject(new Error('FFmpeg not available'));
          } else {
            console.log('FFmpeg is available');
            resolve();
          }
        });
      });
    } catch (ffmpegError) {
      console.error('FFmpeg not available:', ffmpegError);
      return NextResponse.json(
        { error: 'Video processing is temporarily unavailable' },
        { status: 503 }
      );
    }
    const body = await req.json();
    const { name, inputVideos, beatMarkers, audioUrl, quality = 'balanced' }: {
      name: string;
      inputVideos: VideoInput[];
      beatMarkers: number[];
      audioUrl: string;
      quality?: 'fast' | 'balanced' | 'high';
    } = body;

    // Validate input
    if (!inputVideos || !beatMarkers || inputVideos.length === 0 || beatMarkers.length < 2) {
      return NextResponse.json(
        { error: 'Invalid input: need videos and at least 2 beat markers' },
        { status: 400 }
      );
    }

    if (!audioUrl) {
      return NextResponse.json(
        { error: 'Audio file is required' },
        { status: 400 }
      );
    }

    console.log('🎬 PROCESS: Input validated', {
      videosCount: inputVideos.length,
      beatMarkersCount: beatMarkers.length,
      quality
    });

    // Simple, stable quality settings
    const qualitySettings = {
      fast: { 
        preset: 'veryfast',
        crf: '23',
        resolution: '1280x720'
      },
      balanced: { 
        preset: 'fast',
        crf: '21',
        resolution: '1280x720'
      },
      high: { 
        preset: 'slow',
        crf: '18',
        resolution: '1920x1080'
      }
    };

    const settings = qualitySettings[quality] || qualitySettings.balanced;

    // Create directories
    const outputDir = path.join(process.cwd(), 'public', 'exports');
    const tempDir = path.join(process.cwd(), 'tmp');
    await mkdir(outputDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });

    const outputId = uuidv4();
    const outputPath = path.join(outputDir, `${outputId}.mp4`);
    const outputUrl = `/api/download/${outputId}`;

    console.log('🎬 PROCESS: Output details', {
      outputId,
      outputPath,
      outputUrl
    });

    // Create segments
    const segments = [];
    for (let i = 0; i < beatMarkers.length - 1; i++) {
      const videoIndex = i % inputVideos.length;
      const duration = beatMarkers[i + 1] - beatMarkers[i];
      
      segments.push({
        video: inputVideos[videoIndex],
        startTime: 0,
        duration: duration,
        index: i
      });
    }

    console.log('🎬 PROCESS: Processing segments', {
      segmentsCount: segments.length
    });

    // Step 1: Process each segment with simple, stable approach
    const segmentPaths: string[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentPath = path.join(tempDir, `segment_${i}.mp4`);
      segmentPaths.push(segmentPath);

      // Convert URL to absolute path
      let videoPath = segment.video.url;
      if (videoPath.startsWith('/uploads/')) {
        videoPath = path.join(process.cwd(), 'public', segment.video.url);
      }

      console.log(`🎬 PROCESS: Cutting segment ${i + 1}/${segments.length}`);

      // Simple, stable FFmpeg command
      await new Promise<void>((resolve, reject) => {
        ffmpeg(videoPath)
          .setStartTime(segment.startTime)
          .setDuration(segment.duration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size(settings.resolution)
          .outputOptions([
            '-preset', settings.preset,
            '-crf', settings.crf,
            '-movflags', '+faststart',
            '-y'
          ])
          .output(segmentPath)
          .on('end', () => {
            console.log(`🎬 PROCESS: Segment ${i + 1} completed`);
            resolve();
          })
          .on('error', (error) => {
            console.error(`🎬 PROCESS: Segment ${i + 1} failed:`, error.message);
            reject(error);
          })
          .run();
      });
    }

    // Step 2: Concatenate segments (simple concat)
    console.log('🎬 PROCESS: Concatenating segments...');
    
    const concatFilePath = path.join(tempDir, 'concat.txt');
    const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
    await writeFile(concatFilePath, concatContent, 'utf8');

    const videoOnlyPath = path.join(tempDir, 'video_only.mp4');
    
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatFilePath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('copy')
        .audioCodec('copy')
        .outputOptions(['-y'])
        .output(videoOnlyPath)
        .on('end', () => {
          console.log('🎬 PROCESS: Concatenation completed');
          resolve();
        })
        .on('error', (error) => {
          console.error('🎬 PROCESS: Concatenation failed:', error);
          reject(error);
        })
        .run();
    });

    // Step 3: Add audio track (simple merge)
    console.log('🎬 PROCESS: Adding audio track...');
    
    let audioPath = audioUrl;
    if (audioPath.startsWith('/uploads/')) {
      audioPath = path.join(process.cwd(), 'public', audioPath);
    }

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoOnlyPath)
        .input(audioPath)
        .videoCodec('copy')
        .audioCodec('aac')
        .audioBitrate('192k')
        .outputOptions([
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-y'
        ])
        .output(outputPath)
        .on('end', async () => {
          console.log('🎬 PROCESS: Export completed successfully');
          
          // Clean up temp files
          try {
            await unlink(concatFilePath);
            await unlink(videoOnlyPath);
            for (const segPath of segmentPaths) {
              await unlink(segPath);
            }
          } catch (e) {
            console.warn('Cleanup warning:', e);
          }
          
          resolve();
        })
        .on('error', (error) => {
          console.error('🎬 PROCESS: Audio merge failed:', error);
          reject(error);
        })
        .run();
    });

    const processingTime = Date.now() - startTime;
    console.log('🎬 PROCESS: All processing completed', {
      outputUrl,
      processingTimeMs: processingTime
    });

    return NextResponse.json({
      success: true,
      outputUrl,
      processingTime
    });

  } catch (error) {
    console.error('🎬 PROCESS: Processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json(
      { 
        error: 'Processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 