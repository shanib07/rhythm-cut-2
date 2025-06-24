const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs').promises;

const prisma = new PrismaClient();

// Create processing queue
const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

// Process videos based on beat markers
async function processVideo(inputVideos, beatMarkers, outputPath) {
  return new Promise((resolve, reject) => {
    if (!inputVideos || inputVideos.length === 0) {
      reject(new Error('No input videos provided'));
      return;
    }

    // For simplicity, use only the first video for now
    const firstVideo = inputVideos[0];
    const duration = beatMarkers.length > 1 ? beatMarkers[1] - beatMarkers[0] : 10;

    console.log(`Processing video: ${firstVideo.url}`);
    console.log(`Duration: ${duration} seconds`);

    ffmpeg(firstVideo.url)
      .seekInput(beatMarkers[0] || 0)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', 'fast',
        '-crf', '23',
        '-movflags', '+faststart'
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent || 0}% done`);
      })
      .on('end', () => {
        console.log('Video processing completed');
        resolve(outputPath);
      })
      .on('error', (error) => {
        console.error('FFmpeg error:', error);
        reject(error);
      })
      .run();
  });
}

// Process jobs from the queue
videoQueue.process('process-video', async (job) => {
  const { projectId } = job.data;
  
  try {
    console.log(`Starting video processing for project: ${projectId}`);
    
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
      inputVideos: project.inputVideos?.length,
      beatMarkers: project.beatMarkers?.length
    });

    // Create temp output directory if it doesn't exist
    const outputDir = path.join(__dirname, '../tmp/exports');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `${projectId}.mp4`);

    // Process the video
    await processVideo(project.inputVideos, project.beatMarkers, outputPath);

    // For now, serve the file directly
    // In production, upload to cloud storage
    const outputUrl = `/api/download/${projectId}`;

    // Update project with success
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'completed',
        outputUrl
      }
    });

    console.log(`Video processing completed for project: ${projectId}`);
    return { success: true, outputUrl };

  } catch (error) {
    console.error(`Video processing failed for project: ${projectId}`, error);
    
    // Update project with error
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'error' }
    });

    throw error;
  }
});

// Handle failed jobs
videoQueue.on('failed', async (job, error) => {
  console.error(`Job ${job.id} failed:`, error);
  
  // Update project status on failure
  if (job.data.projectId) {
    try {
      await prisma.project.update({
        where: { id: job.data.projectId },
        data: { status: 'error' }
      });
    } catch (updateError) {
      console.error('Failed to update project status:', updateError);
    }
  }
});

console.log('Video processing worker is running...'); 