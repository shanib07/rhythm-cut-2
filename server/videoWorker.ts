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

// Fallback simple processing for when complex filters fail
async function processVideoSimple(
  inputVideos: VideoInput[],
  beatMarkers: number[],
  outputPath: string,
  options: ProcessingOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('Using simple processing method');
    
    if (inputVideos.length === 0 || beatMarkers.length === 0) {
      reject(new Error('Invalid input data'));
      return;
    }

    // For simple processing, just use the first video and trim it to the beat markers
    const firstVideo = inputVideos[0];
    const startTime = beatMarkers[0] || 0;
    const endTime = beatMarkers[beatMarkers.length - 1] || 30; // Default 30 seconds
    const duration = endTime - startTime;

    console.log(`Simple processing: ${firstVideo.url} from ${startTime}s to ${endTime}s`);

    const videoQuality = options.quality === 'low' ? '28' : '23';
    const videoResolution = options.resolution === '720p' ? '1280x720' : '1920x1080';

    ffmpeg(firstVideo.url)
      .seekInput(startTime)
      .duration(duration)
      .size(videoResolution)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf', videoQuality,
        '-preset', 'fast',
        '-movflags', '+faststart'
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('Simple FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Simple processing: ${progress.percent}% done`);
      })
      .on('end', () => {
        console.log('Simple video processing completed');
        resolve(outputPath);
      })
      .on('error', (error) => {
        console.error('Simple FFmpeg error:', error);
        reject(error);
      })
      .run();
  });
}

// Process videos based on beat markers
async function processVideo(
  inputVideos: VideoInput[],
  beatMarkers: number[],
  outputPath: string,
  options: ProcessingOptions
): Promise<string> {
  try {
    // Try complex processing first
    return await processVideoComplex(inputVideos, beatMarkers, outputPath, options);
  } catch (error) {
    console.warn('Complex processing failed, trying simple method:', error);
    // Fallback to simple processing
    return await processVideoSimple(inputVideos, beatMarkers, outputPath, options);
  }
}

// Complex video processing with beat synchronization
async function processVideoComplex(
  inputVideos: VideoInput[],
  beatMarkers: number[],
  outputPath: string,
  options: ProcessingOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('Starting complex video processing with:', {
      videoCount: inputVideos.length,
      beatMarkers,
      options,
      outputPath
    });

    if (inputVideos.length === 0) {
      reject(new Error('No input videos provided'));
      return;
    }

    if (beatMarkers.length === 0) {
      reject(new Error('No beat markers provided'));
      return;
    }

    let command = ffmpeg();
    
    // Add all input videos
    inputVideos.forEach((video, index) => {
      console.log(`Adding input video ${index}: ${video.url}`);
      command = command.input(video.url);
    });

    // Simplified approach: just concatenate video segments at beat points
    // Instead of complex filters, use simpler trim and concat
    const filterComplex: string[] = [];
    
    // Create segments based on beat markers
    for (let i = 0; i < beatMarkers.length - 1; i++) {
      const videoIndex = i % inputVideos.length; // Cycle through videos
      const startTime = beatMarkers[i];
      const duration = beatMarkers[i + 1] - beatMarkers[i];
      
      console.log(`Creating segment ${i}: video ${videoIndex}, start ${startTime}s, duration ${duration}s`);
      
      // Trim video segment
      filterComplex.push(
        `[${videoIndex}:v]trim=start=${startTime}:duration=${duration},setpts=PTS-STARTPTS[v${i}];` +
        `[${videoIndex}:a]atrim=start=${startTime}:duration=${duration},asetpts=PTS-STARTPTS[a${i}]`
      );
    }
    
    // Concatenate all segments
    const videoInputs = Array.from({ length: beatMarkers.length - 1 }, (_, i) => `[v${i}]`).join('');
    const audioInputs = Array.from({ length: beatMarkers.length - 1 }, (_, i) => `[a${i}]`).join('');
    
    filterComplex.push(
      `${videoInputs}concat=n=${beatMarkers.length - 1}:v=1:a=0[outv];` +
      `${audioInputs}concat=n=${beatMarkers.length - 1}:v=0:a=1[outa]`
    );

    console.log('Filter complex:', filterComplex.join(' '));

    // Set quality based on preview/export
    const videoQuality = options.quality === 'low' ? '28' : '23'; // Higher CRF = lower quality
    const videoResolution = options.resolution === '720p' ? '1280x720' : '1920x1080';

    command
      .complexFilter(filterComplex.join(' '))
      .outputOptions([
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-crf', videoQuality,
        '-preset', 'fast',
        '-movflags', '+faststart'
      ])
      .size(videoResolution)
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent}% done, time: ${progress.timemark}`);
      })
      .on('end', () => {
        console.log('Video processing completed successfully');
        resolve(outputPath);
      })
      .on('error', (error) => {
        console.error('FFmpeg error:', error);
        reject(error);
      })
      .run();
  });
}

// Handle preview generation
previewQueue.process('create-preview', async (job) => {
  const { inputVideos, beatMarkers, quality, resolution } = job.data;
  
  try {
    console.log('Starting preview generation for job:', job.id);
    
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

    console.log('Preview generation completed for job:', job.id);
    
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

    console.log('Parsed input videos:', inputVideos.length);

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

    console.log('Export completed for project:', projectId);

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