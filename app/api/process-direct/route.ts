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

    console.log('🚀 DIRECT-PROCESS: Processing request', {
      videosCount: inputVideos.length,
      beatMarkersCount: beatMarkers.length,
      hasAudio: !!audioUrl,
      quality
    });

    // Quality settings with processing methods
    const qualitySettings = {
      fast: { 
        method: 'copy',
        crf: '17', 
        preset: 'ultrafast', 
        tune: 'fastdecode', 
        resolution: '1280x720',
        keyint: '1'
      },
      balanced: { 
        method: 'smart-copy',
        crf: '18', 
        preset: 'faster', 
        tune: 'film', 
        resolution: '1280x720',
        keyint: '1'
      },
      high: { 
        method: 'precise',
        crf: '16', 
        preset: 'medium', 
        tune: 'film', 
        resolution: '1920x1080',
        keyint: '30'
      }
    };

    const settings = qualitySettings[quality] || qualitySettings.balanced;

    // Create output directory
    const outputDir = path.join(process.cwd(), 'public', 'exports');
    await mkdir(outputDir, { recursive: true });

    const outputId = uuidv4();
    const outputPath = path.join(outputDir, `${outputId}.mp4`);
    const outputUrl = `/api/download/${outputId}`;

    // Create segments with timing info
    const segments = [];
    for (let i = 0; i < beatMarkers.length - 1; i++) {
      const videoIndex = i % inputVideos.length;
      const segmentDuration = beatMarkers[i + 1] - beatMarkers[i];
      
      segments.push({
        video: inputVideos[videoIndex],
        startTime: 0,
        duration: segmentDuration,
        segmentIndex: i,
        outputStartTime: beatMarkers[i],
        outputEndTime: beatMarkers[i + 1]
      });
    }

    console.log('🚀 DIRECT-PROCESS: Created segments', {
      segmentsCount: segments.length,
      processingMethod: settings.method
    });

    // Process segments with optimized approach
    const segmentPaths: string[] = [];
    const tempDir = path.join(process.cwd(), 'tmp');
    await mkdir(tempDir, { recursive: true });

    // Determine batch size based on method
    const BATCH_SIZE = settings.method === 'copy' ? Math.min(segments.length, 10) : 
                       segments.length <= 5 ? segments.length : 3;
    const segmentPromises: Array<() => Promise<string>> = [];

    // Create promises for each segment with optimized processing
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentPath = path.join(tempDir, `segment_${i}_${outputId}.mp4`);
      segmentPaths.push(segmentPath);

      segmentPromises.push(async () => {
        // Convert URL to absolute path
        let videoPath = segment.video.url;
        if (videoPath.startsWith('/uploads/')) {
          videoPath = path.join(process.cwd(), 'public', segment.video.url);
        }

        console.log(`🚀 DIRECT-PROCESS: Processing segment ${i}/${segments.length} using ${settings.method} method`);

        await new Promise<void>((resolve, reject) => {
          let ffmpegCmd = ffmpeg(videoPath);

          // Apply method-specific processing
          if (settings.method === 'copy') {
            // Ultra-fast: Direct copy without re-encoding
            ffmpegCmd
              .seekInput(segment.startTime)
              .inputOptions(['-noaccurate_seek'])  // Fast seek
              .duration(segment.duration)
              .videoCodec('copy')
              .noAudio()
              .outputOptions([
                '-avoid_negative_ts', 'make_zero',
                '-fflags', '+genpts',
                '-y'
              ]);
          } else if (settings.method === 'smart-copy') {
            // Balanced: Smart copy with minimal re-encoding
            ffmpegCmd
              .seekInput(segment.startTime)
              .inputOptions(['-accurate_seek'])  // Accurate seek for better cuts
              .duration(segment.duration)
              .videoCodec('libx264')
              .noAudio()
              .size(settings.resolution)
              .outputOptions([
                '-crf', settings.crf,
                '-preset', settings.preset,
                '-tune', settings.tune,
                '-g', settings.keyint,  // Short GOP for precise cuts
                '-keyint_min', settings.keyint,
                '-sc_threshold', '0',  // Disable scene detection
                '-movflags', '+faststart',
                '-avoid_negative_ts', 'make_zero',
                '-fflags', '+genpts',
                '-threads', '0',
                '-y'
              ]);
          } else {
            // High quality: Full re-encode with best settings
            ffmpegCmd
              .seekInput(segment.startTime)
              .inputOptions(['-accurate_seek'])
              .duration(segment.duration)
              .videoCodec('libx264')
              .noAudio()
              .size(settings.resolution)
              .outputOptions([
                '-crf', settings.crf,
                '-preset', settings.preset,
                '-tune', settings.tune,
                '-profile:v', 'high',
                '-level', '4.1',
                '-movflags', '+faststart',
                '-avoid_negative_ts', 'make_zero',
                '-fflags', '+genpts',
                '-vsync', 'cfr',
                '-threads', '0',
                '-max_muxing_queue_size', '1024',
                '-y'
              ]);
          }

          // Add error handling with fallback for copy method
          let retryWithEncode = false;
          
          ffmpegCmd
            .output(segmentPath)
            .on('start', (cmd) => {
              console.log(`🚀 DIRECT-PROCESS: FFmpeg command for segment ${i} (${settings.method})`, cmd.split(' ').slice(0, 10).join(' ') + '...');
            })
            .on('progress', (progress) => {
              if (progress.percent && i % 5 === 0) {  // Log less frequently
                console.log(`🚀 DIRECT-PROCESS: Segment ${i} - ${progress.percent.toFixed(1)}%`);
              }
            })
            .on('end', () => {
              console.log(`🚀 DIRECT-PROCESS: Segment ${i} completed`);
              resolve();
            })
            .on('error', async (error) => {
              console.error(`🚀 DIRECT-PROCESS: Segment ${i} failed:`, error.message);
              
              // If copy method failed, retry with encoding
              if (settings.method === 'copy' && !retryWithEncode) {
                console.log(`🚀 DIRECT-PROCESS: Retrying segment ${i} with encoding...`);
                retryWithEncode = true;
                
                // Retry with smart encoding
                await new Promise<void>((retryResolve, retryReject) => {
                  ffmpeg(videoPath)
                    .seekInput(segment.startTime)
                    .inputOptions(['-accurate_seek'])
                    .duration(segment.duration)
                    .videoCodec('libx264')
                    .noAudio()
                    .size('1280x720')
                    .outputOptions([
                      '-crf', '18',
                      '-preset', 'faster',
                      '-movflags', '+faststart',
                      '-avoid_negative_ts', 'make_zero',
                      '-y'
                    ])
                    .output(segmentPath)
                    .on('end', () => {
                      console.log(`🚀 DIRECT-PROCESS: Segment ${i} retry successful`);
                      retryResolve();
                    })
                    .on('error', (retryError) => {
                      console.error(`🚀 DIRECT-PROCESS: Segment ${i} retry failed:`, retryError);
                      retryReject(retryError);
                    })
                    .run();
                });
                
                resolve();
              } else {
                reject(error);
              }
            })
            .run();
        });

        return segmentPath;
      });
    }

    // Process segments in batches
    console.log(`🚀 DIRECT-PROCESS: Processing ${segments.length} segments in batches of ${BATCH_SIZE}`);
    for (let i = 0; i < segmentPromises.length; i += BATCH_SIZE) {
      const batch = segmentPromises.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(fn => fn()));
      console.log(`🚀 DIRECT-PROCESS: Batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
    }

    // Create concat file for video segments
    const concatFilePath = path.join(tempDir, `concat_${outputId}.txt`);
    const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
    await writeFile(concatFilePath, concatContent, 'utf8');

    console.log('🚀 DIRECT-PROCESS: Concatenating video segments...');

    // Optimized concatenation based on method
    const videoOnlyPath = path.join(tempDir, `video_only_${outputId}.mp4`);
    await new Promise<void>((resolve, reject) => {
      const concatCmd = ffmpeg()
        .input(concatFilePath)
        .inputOptions([
          '-f', 'concat',
          '-safe', '0',
          '-protocol_whitelist', 'file,http,https,tcp,tls'
        ]);

      // Use copy for concatenation when using copy method
      if (settings.method === 'copy') {
        concatCmd
          .videoCodec('copy')
          .noAudio()
          .outputOptions([
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            '-fflags', '+genpts',
            '-y'
          ]);
      } else {
        // For other methods, ensure consistent encoding
        concatCmd
          .videoCodec('copy')  // Still copy since segments are already encoded
          .noAudio()
          .outputOptions([
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            '-y'
          ]);
      }

      concatCmd
        .output(videoOnlyPath)
        .on('start', (cmd) => {
          console.log('🚀 DIRECT-PROCESS: Video concatenation command:', cmd.split(' ').slice(0, 10).join(' ') + '...');
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

    // Optimized final combination based on quality setting
    await new Promise<void>((resolve, reject) => {
      const finalCmd = ffmpeg()
        .input(videoOnlyPath)
        .input(audioPath);

      if (settings.method === 'copy') {
        // Ultra-fast: Direct stream copy
        finalCmd.outputOptions([
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',  // Slightly lower for faster processing
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-movflags', '+faststart',
          '-y'
        ]);
      } else if (settings.method === 'smart-copy') {
        // Balanced: Copy video, good audio
        finalCmd.outputOptions([
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '48000',  // Standard sample rate
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-movflags', '+faststart',
          '-async', '1',    // Better audio sync
          '-y'
        ]);
      } else {
        // High quality: Best settings
        finalCmd.outputOptions([
          '-c:v', 'copy',   // Video already encoded at high quality
          '-c:a', 'aac',
          '-b:a', '256k',   // High quality audio
          '-ar', '48000',
          '-ac', '2',       // Stereo
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-movflags', '+faststart',
          '-async', '1',
          '-vsync', 'cfr',
          '-y'
        ]);
      }

      finalCmd
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('🚀 DIRECT-PROCESS: Final combination command:', cmd.split(' ').slice(0, 10).join(' ') + '...');
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