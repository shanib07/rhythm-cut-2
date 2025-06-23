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

// Very simple processing - just take the first video and create a short clip
async function processVideoBasic(
  inputVideos: VideoInput[],
  beatMarkers: number[],
  outputPath: string,
  options: ProcessingOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('Using basic processing method');
    
    if (inputVideos.length === 0) {
      reject(new Error('No input videos provided'));
      return;
    }

    // Use the first video only
    const firstVideo = inputVideos[0];
    const startTime = beatMarkers[0] || 0;
    const duration = Math.min(10, (beatMarkers[1] || 10) - startTime); // Max 10 seconds

    console.log(`Basic processing: ${firstVideo.url} from ${startTime}s for ${duration}s`);

    const videoQuality = options.quality === 'low' ? '30' : '25';

    ffmpeg(firstVideo.url)
      .seekInput(startTime)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('640x480') // Fixed small size for testing
      .outputOptions([
        '-crf', videoQuality,
        '-preset', 'ultrafast',
        '-tune', 'fastdecode',
        '-movflags', '+faststart',
        '-avoid_negative_ts', 'make_zero'
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('Basic FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Basic processing: ${progress.percent || 0}% done, frames: ${progress.frames}`);
      })
      .on('end', () => {
        console.log('Basic video processing completed');
        resolve(outputPath);
      })
      .on('error', (error) => {
        console.error('Basic FFmpeg error:', error);
        reject(error);
      })
      .run();
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
    await processVideoBasic(
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
    await processVideoBasic(
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