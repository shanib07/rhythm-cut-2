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
    let command = ffmpeg();
    
    // Add all input videos
    inputVideos.forEach(videoPath => {
      command = command.input(videoPath);
    });

    // Generate complex filter for video switching
    const filterComplex = [];
    let outputSelector = [];
    
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

    command
      .complexFilter(filterComplex, ['outv'])
      .map('[outv]')
      .videoCodec('libx264')
      .output(outputPath)
      .on('progress', progress => {
        console.log(`Processing: ${progress.percent}% done`);
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// Process jobs from the queue
videoQueue.process(async (job) => {
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

    // Create temp output directory if it doesn't exist
    const outputDir = path.join(__dirname, '../tmp');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `${projectId}.mp4`);

    // Process the video
    await processVideo(project.inputVideos, project.beatMarkers, outputPath);

    // TODO: Upload the output file to cloud storage
    const outputUrl = outputPath; // This should be the cloud storage URL in production

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
videoQueue.on('failed', async (job, error) => {
  console.error(`Job ${job.id} failed:`, error);
  
  // Update project status on failure
  const { projectId } = job.data;
  await prisma.project.update({
    where: { id: projectId },
    data: { status: 'error' }
  });
});

console.log('Video processing worker is running...'); 