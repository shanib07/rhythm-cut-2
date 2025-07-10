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

    // Highly optimized quality settings for maximum performance
    const qualitySettings = {
      fast: { 
        preset: 'ultrafast',
        crf: '30', // Higher CRF for smaller files and faster encoding
        resolution: '854x480',
        extraOptions: [
          '-tune', 'fastdecode', // Optimize for fast decoding
          '-movflags', '+faststart',
          '-threads', '0',
          '-x264-params', 'ref=1:bframes=0:cabac=0:8x8dct=0:weightp=0:me=dia:subme=0:rc-lookahead=0', // Disable complex features
          '-profile:v', 'baseline',
          '-level', '3.0',
          '-pix_fmt', 'yuv420p' // Ensure compatibility
        ]
      },
      balanced: { 
        preset: 'veryfast', // Faster than 'superfast' with good quality
        crf: '24',
        resolution: '1280x720',
        extraOptions: [
          '-movflags', '+faststart',
          '-threads', '0',
          '-tune', 'film',
          '-x264-params', 'ref=2:bframes=2:rc-lookahead=20', // Balanced settings
          '-profile:v', 'main',
          '-pix_fmt', 'yuv420p'
        ]
      },
      high: { 
        preset: 'medium', // Better quality than 'fast'
        crf: '19', // Lower CRF for higher quality
        resolution: '1920x1080',
        extraOptions: [
          '-movflags', '+faststart',
          '-threads', '0',
          '-tune', 'film',
          '-x264-params', 'ref=4:bframes=3:rc-lookahead=40:aq-mode=2', // High quality settings
          '-profile:v', 'high',
          '-level', '4.1',
          '-pix_fmt', 'yuv420p',
          '-bf', '3' // More B-frames for better compression
        ]
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

    // Step 1: Process segments in parallel for massive speed improvement
    const segmentPaths: string[] = [];
    const os = await import('os');
    const BATCH_SIZE = Math.max(2, Math.min(os.cpus().length, 4)); // Use 2-4 parallel processes
    
    console.log(`🚀 PROCESS: Using ${BATCH_SIZE} parallel workers for segment processing`);
    
    // Pre-allocate segment paths
    for (let i = 0; i < segments.length; i++) {
      segmentPaths.push(path.join(tempDir, `segment_${i}.mp4`));
    }
    
    // Process segments in parallel batches
    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, Math.min(i + BATCH_SIZE, segments.length));
      const batchPromises = batch.map(async (segment, batchIndex) => {
        const segmentIndex = i + batchIndex;
        const segmentPath = segmentPaths[segmentIndex];
        
        // Convert URL to absolute path
        let videoPath = segment.video.url;
        if (videoPath.startsWith('/uploads/')) {
          videoPath = path.join(process.cwd(), 'public', segment.video.url);
        }

        console.log(`🎬 PROCESS: Starting segment ${segmentIndex + 1}/${segments.length}`);

        // Optimized FFmpeg command with multi-threading
        return new Promise<void>((resolve, reject) => {
          const ffmpegCommand = ffmpeg(videoPath)
            .setStartTime(segment.startTime)
            .setDuration(segment.duration);
          
          // For fast mode, try to avoid re-encoding when possible
          if (quality === 'fast' && segment.duration < 3) {
            ffmpegCommand
              .videoCodec('copy')
              .audioCodec('copy');
          } else {
            ffmpegCommand
              .videoCodec('libx264')
              .audioCodec('aac')
              .size(settings.resolution)
              .outputOptions([
                '-preset', settings.preset,
                '-crf', settings.crf,
                ...settings.extraOptions,
                '-threads', '2', // Limit threads per segment to avoid overload
                '-y'
              ]);
          }
          
          ffmpegCommand
            .output(segmentPath)
            .on('end', () => {
              console.log(`✅ PROCESS: Segment ${segmentIndex + 1} completed`);
              resolve();
            })
            .on('error', (error) => {
              console.error(`❌ PROCESS: Segment ${segmentIndex + 1} failed:`, error.message);
              reject(error);
            })
            .run();
        });
      });
      
      // Wait for batch to complete before starting next batch
      await Promise.all(batchPromises);
      console.log(`🎬 PROCESS: Batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
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