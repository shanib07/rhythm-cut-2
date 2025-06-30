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
  console.log('🚀 DIRECT-PROCESS: Request received', {
    timestamp: new Date().toISOString()
  });

  try {
    const body = await req.json();
    const { name, inputVideos, beatMarkers } = body;

    // Validate input
    if (!inputVideos || !beatMarkers || inputVideos.length === 0 || beatMarkers.length < 2) {
      return NextResponse.json(
        { error: 'Invalid input: need videos and at least 2 beat markers' },
        { status: 400 }
      );
    }

    console.log('🚀 DIRECT-PROCESS: Processing request', {
      videosCount: inputVideos.length,
      beatMarkersCount: beatMarkers.length
    });

    // Create output directory
    const outputDir = path.join(process.cwd(), 'public', 'exports');
    await mkdir(outputDir, { recursive: true });

    const outputId = uuidv4();
    const outputPath = path.join(outputDir, `${outputId}.mp4`);
    const outputUrl = `/exports/${outputId}.mp4`;

    // Create segments
    const segments = [];
    for (let i = 0; i < beatMarkers.length - 1; i++) {
      const videoIndex = i % inputVideos.length;
      segments.push({
        video: inputVideos[videoIndex],
        startTime: 0,
        duration: beatMarkers[i + 1] - beatMarkers[i],
        segmentIndex: i
      });
    }

    console.log('🚀 DIRECT-PROCESS: Created segments', {
      segmentsCount: segments.length
    });

    // Process segments
    const segmentPaths: string[] = [];
    const tempDir = path.join(process.cwd(), 'tmp');
    await mkdir(tempDir, { recursive: true });

    // Process each segment
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentPath = path.join(tempDir, `segment_${i}_${outputId}.mp4`);
      segmentPaths.push(segmentPath);

      // Convert URL to absolute path
      let videoPath = segment.video.url;
      if (videoPath.startsWith('/uploads/')) {
        videoPath = path.join(process.cwd(), 'public', segment.video.url);
      }

      console.log(`🚀 DIRECT-PROCESS: Processing segment ${i}/${segments.length}`);

      await new Promise<void>((resolve, reject) => {
        // Use optimized settings for speed and no gaps
        const ffmpegCmd = ffmpeg(videoPath)
          .seekInput(segment.startTime)
          .inputOptions([
            '-accurate_seek',
            '-noaccurate_seek'  // Disable for speed after initial seek
          ])
          .duration(segment.duration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size('1280x720')
          .outputOptions([
            '-crf', '28',           // Higher CRF for faster encoding (23->28)
            '-preset', 'ultrafast', // Fastest preset
            '-tune', 'fastdecode',  // Optimize for fast decoding
            '-threads', '0',        // Use all CPU cores
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            '-fflags', '+genpts',
            '-vsync', 'cfr',        // Constant frame rate to avoid gaps
            '-async', '1',          // Audio sync
            '-copyts',              // Copy timestamps
            '-start_at_zero',       // Reset timestamps
            '-max_muxing_queue_size', '1024', // Increase muxing queue
            '-y'
          ])
          .output(segmentPath);

        // Add progress logging
        ffmpegCmd
          .on('start', (cmd) => {
            console.log(`🚀 DIRECT-PROCESS: FFmpeg command for segment ${i}:`, cmd);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`🚀 DIRECT-PROCESS: Segment ${i} - ${progress.percent.toFixed(1)}%`);
            }
          })
          .on('end', () => {
            console.log(`🚀 DIRECT-PROCESS: Segment ${i} completed`);
            resolve();
          })
          .on('error', (error) => {
            console.error(`🚀 DIRECT-PROCESS: Segment ${i} failed:`, error);
            reject(error);
          })
          .run();
      });
    }

    // Create concat file
    const concatFilePath = path.join(tempDir, `concat_${outputId}.txt`);
    const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
    await writeFile(concatFilePath, concatContent, 'utf8');

    console.log('🚀 DIRECT-PROCESS: Concatenating segments...');

    // Concatenate segments with optimized settings
    await new Promise<void>((resolve, reject) => {
      const concatCmd = ffmpeg()
        .input(concatFilePath)
        .inputOptions([
          '-f', 'concat',
          '-safe', '0',
          '-protocol_whitelist', 'file,http,https,tcp,tls'
        ])
        .videoCodec('copy')
        .audioCodec('copy')
        .outputOptions([
          '-movflags', '+faststart',  // Web optimization
          '-avoid_negative_ts', 'make_zero',
          '-map_metadata', '0',       // Copy metadata
          '-y'
        ])
        .output(outputPath);

      concatCmd
        .on('start', (cmd) => {
          console.log('🚀 DIRECT-PROCESS: Concatenation command:', cmd);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`🚀 DIRECT-PROCESS: Concatenation - ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', async () => {
          console.log('🚀 DIRECT-PROCESS: Concatenation completed');
          
          // Clean up temp files
          try {
            await unlink(concatFilePath);
            for (const segPath of segmentPaths) {
              await unlink(segPath);
            }
          } catch (e) {
            console.warn('Failed to clean up temp files:', e);
          }
          
          resolve();
        })
        .on('error', (error) => {
          console.error('🚀 DIRECT-PROCESS: Concatenation failed:', error);
          reject(error);
        })
        .run();
    });

    const processingTime = Date.now() - startTime;
    console.log('🚀 DIRECT-PROCESS: Processing completed', {
      outputUrl,
      processingTimeMs: processingTime
    });

    return NextResponse.json({
      success: true,
      outputUrl,
      processingTime
    });

  } catch (error) {
    console.error('🚀 DIRECT-PROCESS: Processing failed', {
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