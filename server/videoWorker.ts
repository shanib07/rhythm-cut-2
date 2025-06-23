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

// Process videos based on beat markers
async function processVideo(
  inputVideos: VideoInput[],
  beatMarkers: number[],
  outputPath: string,
  options: ProcessingOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    let command = ffmpeg();
    
    // Add all input videos
    inputVideos.forEach(video => {
      command = command.input(video.url);
    });

    // Generate complex filter for video switching
    const filterComplex: string[] = [];
    const outputSelector: string[] = [];
    
    inputVideos.forEach((_, index) => {
      // Enable video until next beat marker
      const duration = index < beatMarkers.length - 1 
        ? beatMarkers[index + 1] - beatMarkers[index]
        : 999999; // Large number for last segment
        
      filterComplex.push(`[${index}:v]trim=start=${beatMarkers[index]}:duration=${duration}[v${index}]`);
      outputSelector.push(`[v${index}]`);
    });
    
    // Concatenate all video segments
    filterComplex.push(`${outputSelector.join('')}concat=n=${inputVideos.length}:v=1[outv]`);

    // Set quality based on preview/export
    const videoQuality = options.quality === 'low' ? '23' : '18'; // Higher CRF = lower quality
    const videoResolution = options.resolution === '720p' ? '1280x720' : '1920x1080';

    command
      .complexFilter(filterComplex, ['outv'])
      .map('[outv]')
      .videoCodec('libx264')
      .size(videoResolution)
      .videoBitrate('2000k')
      .audioCodec('aac')
      .audioBitrate('128k')
      .outputOptions([`-crf ${videoQuality}`])
      .output(outputPath)
      .on('progress', progress => {
        console.log(`Processing: ${progress.percent}% done`);
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// Handle preview generation
previewQueue.process('create-preview', async (job) => {
  const { inputVideos, beatMarkers, quality, resolution } = job.data;
  
  try {
    // Create temp output directory
    const outputDir = path.join(__dirname, '../tmp/previews');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `preview-${job.id}.mp4`);

    // Process the video with lower quality for preview
    await processVideo(
      inputVideos,
      beatMarkers,
      outputPath,
      {
        quality: 'low',
        resolution: '720p'
      }
    );

    // TODO: Upload to cloud storage in production
    const previewUrl = outputPath;

    return { success: true, previewUrl };

  } catch (error) {
    console.error('Preview generation failed:', error);
    throw error;
  }
});

// Handle final video export
exportQueue.process('process-video', async (job) => {
  const { projectId } = job.data;
  
  try {
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

    // Parse input videos from project JSON
    let inputVideos: VideoInput[];
    try {
      // Handle both JSON object and already parsed object
      if (Array.isArray(project.inputVideos)) {
        inputVideos = project.inputVideos as unknown as VideoInput[];
      } else {
        inputVideos = JSON.parse(project.inputVideos as string) as VideoInput[];
      }
    } catch (error) {
      console.error('Failed to parse input videos:', error);
      throw new Error('Invalid input videos format');
    }

    // Create temp output directory
    const outputDir = path.join(__dirname, '../tmp/exports');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `${projectId}.mp4`);

    // Process the video with high quality for export
    await processVideo(
      inputVideos,
      project.beatMarkers,
      outputPath,
      {
        quality: 'high',
        resolution: '1080p'
      }
    );

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
  await prisma.project.update({
    where: { id: projectId },
    data: { status: 'error' }
  });
});

console.log('Video processing worker is running...'); 