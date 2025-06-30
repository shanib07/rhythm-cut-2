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
    const { name, inputVideos, beatMarkers, audioUrl } = body;

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

    console.log('🚀 DIRECT-PROCESS: Processing request', {
      videosCount: inputVideos.length,
      beatMarkersCount: beatMarkers.length,
      hasAudio: !!audioUrl
    });

    // Create output directory
    const outputDir = path.join(process.cwd(), 'public', 'exports');
    await mkdir(outputDir, { recursive: true });

    const outputId = uuidv4();
    const outputPath = path.join(outputDir, `${outputId}.mp4`);
    const outputUrl = `/api/download/${outputId}`;

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

    // Process segments (without audio to avoid conflicts)
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
        // Process video segments without audio to avoid conflicts
        const ffmpegCmd = ffmpeg(videoPath)
          .seekInput(segment.startTime)
          .inputOptions([
            '-accurate_seek',
            '-noaccurate_seek'
          ])
          .duration(segment.duration)
          .videoCodec('libx264')
          .noAudio() // Remove audio from video segments
          .size('1280x720')
          .outputOptions([
            '-crf', '28',
            '-preset', 'ultrafast',
            '-tune', 'fastdecode',
            '-threads', '0',
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            '-fflags', '+genpts',
            '-vsync', 'cfr',
            '-copyts',
            '-start_at_zero',
            '-max_muxing_queue_size', '1024',
            '-y'
          ])
          .output(segmentPath);

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

    // Create concat file for video segments
    const concatFilePath = path.join(tempDir, `concat_${outputId}.txt`);
    const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
    await writeFile(concatFilePath, concatContent, 'utf8');

    console.log('🚀 DIRECT-PROCESS: Concatenating video segments...');

    // First, concatenate video segments without audio
    const videoOnlyPath = path.join(tempDir, `video_only_${outputId}.mp4`);
    await new Promise<void>((resolve, reject) => {
      const concatCmd = ffmpeg()
        .input(concatFilePath)
        .inputOptions([
          '-f', 'concat',
          '-safe', '0',
          '-protocol_whitelist', 'file,http,https,tcp,tls'
        ])
        .videoCodec('copy')
        .noAudio()
        .outputOptions([
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero',
          '-y'
        ])
        .output(videoOnlyPath);

      concatCmd
        .on('start', (cmd) => {
          console.log('🚀 DIRECT-PROCESS: Video concatenation command:', cmd);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`🚀 DIRECT-PROCESS: Video concatenation - ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log('🚀 DIRECT-PROCESS: Video concatenation completed');
          resolve();
        })
        .on('error', (error) => {
          console.error('🚀 DIRECT-PROCESS: Video concatenation failed:', error);
          reject(error);
        })
        .run();
    });

    // Convert audio URL to absolute path
    let audioPath = audioUrl;
    if (audioPath.startsWith('/uploads/')) {
      audioPath = path.join(process.cwd(), 'public', audioPath);
    }

    console.log('🚀 DIRECT-PROCESS: Combining video with audio track...');

    // Finally, combine the concatenated video with the audio track
    await new Promise<void>((resolve, reject) => {
      const finalCmd = ffmpeg()
        .input(videoOnlyPath)
        .input(audioPath)
        .outputOptions([
          '-c:v', 'copy',  // Copy video without re-encoding
          '-c:a', 'aac',   // Encode audio to AAC
          '-map', '0:v:0', // Map video from first input
          '-map', '1:a:0', // Map audio from second input
          '-shortest',     // End when shortest stream ends
          '-movflags', '+faststart',
          '-y'
        ])
        .output(outputPath);

      finalCmd
        .on('start', (cmd) => {
          console.log('🚀 DIRECT-PROCESS: Final combination command:', cmd);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`🚀 DIRECT-PROCESS: Final combination - ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', async () => {
          console.log('🚀 DIRECT-PROCESS: Final combination completed');
          
          // Clean up temp files
          try {
            await unlink(concatFilePath);
            await unlink(videoOnlyPath);
            for (const segPath of segmentPaths) {
              await unlink(segPath);
            }
          } catch (e) {
            console.warn('Failed to clean up temp files:', e);
          }
          
          resolve();
        })
        .on('error', (error) => {
          console.error('🚀 DIRECT-PROCESS: Final combination failed:', error);
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