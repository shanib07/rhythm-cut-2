import Queue from 'bull';
import ffmpeg from 'fluent-ffmpeg';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

interface VideoInput {
  id: string;
  url: string;
  duration: number;
}

interface ProcessingOptions {
  quality: 'low' | 'high';
  resolution: '720p' | '1080p';
}

// Create queues for preview and export
const previewQueue = new Queue('video-preview', process.env.REDIS_URL);
const exportQueue = new Queue('video-processing', process.env.REDIS_URL);

// Process videos based on beat markers - creates segments from each video
async function processVideoWithBeats(
  inputVideos: VideoInput[],
  beatMarkers: number[],
  outputPath: string,
  options: ProcessingOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('Processing video with beats');
    console.log(`Videos: ${inputVideos.length}, Beats: ${beatMarkers.length}`);
    
    if (inputVideos.length === 0 || beatMarkers.length === 0) {
      reject(new Error('No input videos or beat markers provided'));
      return;
    }

    // Create segments based on beat markers
    const segments: Array<{video: VideoInput, startTime: number, duration: number}> = [];
    
    for (let i = 0; i < beatMarkers.length - 1; i++) {
      const videoIndex = i % inputVideos.length; // Cycle through videos
      const startTime = beatMarkers[i];
      const endTime = beatMarkers[i + 1];
      const duration = endTime - startTime;
      
      segments.push({
        video: inputVideos[videoIndex],
        startTime: 0, // Start from beginning of each video clip
        duration: duration
      });
    }

    console.log(`Created ${segments.length} segments`);

    // For preview, limit segments
    const segmentsToProcess = options.quality === 'low' 
      ? segments.slice(0, Math.min(3, segments.length))
      : segments;

    // Create temporary files for each segment
    const tempDir = path.dirname(outputPath);
    const segmentPaths: string[] = [];

    // Process each segment
    Promise.all(segmentsToProcess.map((segment, index) => {
      return new Promise<string>((segResolve, segReject) => {
        const segmentPath = path.join(tempDir, `segment_${index}.mp4`);
        segmentPaths.push(segmentPath);

        const videoQuality = options.quality === 'low' ? '28' : '23';
        const resolution = options.resolution === '720p' ? '1280x720' : '1920x1080';

        ffmpeg(segment.video.url)
          .seekInput(segment.startTime)
          .duration(segment.duration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size(resolution)
          .outputOptions([
            '-crf', videoQuality,
            '-preset', options.quality === 'low' ? 'ultrafast' : 'fast',
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero'
          ])
          .output(segmentPath)
          .on('end', () => {
            console.log(`Segment ${index} completed`);
            segResolve(segmentPath);
          })
          .on('error', (error) => {
            console.error(`Segment ${index} failed:`, error);
            segReject(error);
          })
          .run();
      });
    }))
    .then(() => {
      // Concatenate all segments
      console.log('Concatenating segments...');
      
      const concatCommand = ffmpeg();
      
      // Add all segment inputs
      segmentPaths.forEach(segPath => {
        concatCommand.input(segPath);
      });

      // Create filter complex for concatenation
      const inputs = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
      const filterComplex = `${inputs}concat=n=${segmentPaths.length}:v=1:a=1[outv][outa]`;

      concatCommand
        .complexFilter(filterComplex)
        .outputOptions([
          '-map', '[outv]',
          '-map', '[outa]',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', options.quality === 'low' ? 'ultrafast' : 'fast'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Concat command:', commandLine);
        })
        .on('end', async () => {
          console.log('Concatenation completed');
          
          // Clean up temporary segment files
          for (const segPath of segmentPaths) {
            try {
              await fs.unlink(segPath);
            } catch (error) {
              console.error(`Failed to delete segment: ${segPath}`);
            }
          }
          
          resolve(outputPath);
        })
        .on('error', (error) => {
          console.error('Concatenation error:', error);
          reject(error);
        })
        .run();
    })
    .catch(reject);
  });
}

// Handle preview generation
previewQueue.process('create-preview', async (job) => {
  const { inputVideos, beatMarkers } = job.data;
  
  try {
    console.log('Starting preview generation for job:', job.id);
    console.log('Input data:', { 
      videoCount: inputVideos?.length,
      beatMarkers: beatMarkers?.slice(0, 3) // Log first 3 beat markers
    });
    
    // Create temp output directory
    const outputDir = path.join(__dirname, '../tmp/previews');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `preview-${job.id}.mp4`);
    console.log('Output path:', outputPath);

    // Use basic processing for preview
    await processVideoWithBeats(
      inputVideos,
      beatMarkers,
      outputPath,
      {
        quality: 'low',
        resolution: '720p'
      }
    );

    console.log('Preview generation completed for job:', job.id);
    
    // Check if file was created
    try {
      const stats = await fs.stat(outputPath);
      console.log('Output file size:', stats.size, 'bytes');
    } catch (error) {
      console.error('Output file not found:', error);
      throw new Error('Output file was not created');
    }

    return { success: true, previewUrl: outputPath };

  } catch (error) {
    console.error('Preview generation failed for job:', job.id, error);
    throw error;
  }
});

// Handle final video export
exportQueue.process('process-video', async (job) => {
  const { projectId } = job.data;
  
  try {
    console.log('Starting export for project:', projectId);
    
    // Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'processing' }
    });

    // Get project details
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project) {
      throw new Error('Project not found');
    }

    console.log('Project data:', {
      id: project.id,
      beatMarkers: project.beatMarkers,
      inputVideosType: typeof project.inputVideos
    });

    // Parse input videos from project JSON
    let inputVideos: VideoInput[];
    try {
      if (Array.isArray(project.inputVideos)) {
        inputVideos = project.inputVideos as unknown as VideoInput[];
      } else {
        inputVideos = JSON.parse(project.inputVideos as string) as VideoInput[];
      }
    } catch (error) {
      console.error('Failed to parse input videos:', error);
      throw new Error('Invalid input videos format');
    }

    console.log('Parsed input videos:', inputVideos.length);

    // Create temp output directory
    const outputDir = path.join(__dirname, '../tmp/exports');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `${projectId}.mp4`);

    // Use basic processing for export too
    await processVideoWithBeats(
      inputVideos,
      project.beatMarkers,
      outputPath,
      {
        quality: 'high',
        resolution: '1080p'
      }
    );

    console.log('Export completed for project:', projectId);

    // Check if file was created
    try {
      const stats = await fs.stat(outputPath);
      console.log('Export file size:', stats.size, 'bytes');
    } catch (error) {
      console.error('Export file not found:', error);
      throw new Error('Export file was not created');
    }

    // TODO: Upload to cloud storage in production
    const outputUrl = outputPath;

    // Update project with success
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'completed',
        outputUrl
      }
    });

    return { success: true, outputUrl };

  } catch (error) {
    console.error('Export failed for project:', projectId, error);
    
    // Update project with error
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'error' }
    });

    throw error;
  }
});

// Handle failed jobs
previewQueue.on('failed', (job, error) => {
  console.error(`Preview job ${job.id} failed:`, error);
});

exportQueue.on('failed', async (job, error) => {
  console.error(`Export job ${job.id} failed:`, error);
  
  const { projectId } = job.data;
  if (projectId) {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'error' }
    });
  }
});

console.log('Video processing worker is running...'); 