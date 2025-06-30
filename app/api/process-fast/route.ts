import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { cpus } from 'os';

interface VideoInput {
  id: string;
  url: string;
  duration: number;
}

// Process segments in parallel batches
async function processSegmentBatch(
  segments: any[],
  tempDir: string,
  outputId: string,
  batchSize: number = cpus().length
): Promise<string[]> {
  const segmentPaths: string[] = [];
  
  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchPaths = await Promise.all(
      batch.map(async (segment, batchIndex) => {
        const segmentIndex = i + batchIndex;
        const segmentPath = path.join(tempDir, `seg_${segmentIndex}_${outputId}.ts`);
        
        // Convert URL to absolute path
        let videoPath = segment.video.url;
        if (videoPath.startsWith('/uploads/')) {
          videoPath = path.join(process.cwd(), 'public', segment.video.url);
        }

        await new Promise<void>((resolve, reject) => {
          ffmpeg(videoPath)
            .seekInput(segment.startTime)
            .inputOptions(['-ss', String(segment.startTime)])
            .duration(segment.duration)
            .outputOptions([
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '30',
              '-g', '48',
              '-keyint_min', '48',
              '-sc_threshold', '0',
              '-c:a', 'aac',
              '-b:a', '128k',
              '-ar', '44100',
              '-f', 'mpegts',
              '-threads', '1',
              '-y'
            ])
            .output(segmentPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
        });

        return segmentPath;
      })
    );
    
    segmentPaths.push(...batchPaths);
  }
  
  return segmentPaths;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  console.log('⚡ FAST-PROCESS: Request received');

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

    console.log('⚡ FAST-PROCESS: Processing request', {
      videosCount: inputVideos.length,
      beatMarkersCount: beatMarkers.length,
      cpuCount: cpus().length
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

    console.log('⚡ FAST-PROCESS: Created segments', {
      segmentsCount: segments.length
    });

    // Process segments in parallel
    const tempDir = path.join(process.cwd(), 'tmp');
    await mkdir(tempDir, { recursive: true });

    console.log('⚡ FAST-PROCESS: Processing segments in parallel...');
    const segmentPaths = await processSegmentBatch(segments, tempDir, outputId);

    // Use concat protocol for super fast concatenation (no re-encoding)
    console.log('⚡ FAST-PROCESS: Concatenating with concat protocol...');
    
    const concatString = segmentPaths.map(p => p).join('|');
    
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`concat:${concatString}`)
        .outputOptions([
          '-c', 'copy',
          '-bsf:a', 'aac_adtstoasc',
          '-movflags', '+faststart',
          '-y'
        ])
        .output(outputPath)
        .on('end', async () => {
          // Clean up
          try {
            for (const segPath of segmentPaths) {
              await unlink(segPath);
            }
          } catch (e) {
            console.warn('Cleanup failed:', e);
          }
          resolve();
        })
        .on('error', reject)
        .run();
    });

    const processingTime = Date.now() - startTime;
    console.log('⚡ FAST-PROCESS: Completed in', processingTime, 'ms');

    return NextResponse.json({
      success: true,
      outputUrl,
      processingTime
    });

  } catch (error) {
    console.error('⚡ FAST-PROCESS: Failed', error);
    return NextResponse.json(
      { 
        error: 'Processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 