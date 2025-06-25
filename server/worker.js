const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs').promises;

const prisma = new PrismaClient();

// Create processing queue
const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

// Process videos based on beat markers
async function processVideoWithBeats(inputVideos, beatMarkers, outputPath, projectId) {
  return new Promise((resolve, reject) => {
    console.log('Processing video with beats');
    console.log(`Videos: ${inputVideos.length}, Beats: ${beatMarkers.length}`);
    
    if (!inputVideos || inputVideos.length === 0 || !beatMarkers || beatMarkers.length === 0) {
      reject(new Error('No input videos or beat markers provided'));
      return;
    }

    // Create segments based on beat markers
    const segments = [];
    
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

    // Create temporary files for each segment
    const tempDir = path.dirname(outputPath);
    const segmentPaths = [];

    // Process each segment
    Promise.all(segments.map((segment, index) => {
      return new Promise((segResolve, segReject) => {
        const segmentPath = path.join(tempDir, `segment_${index}.mp4`);
        segmentPaths.push(segmentPath);

        // Convert relative URL to absolute file path if needed
        let videoPath = segment.video.url;
        if (videoPath.startsWith('/uploads/')) {
          videoPath = path.join(process.cwd(), 'public', segment.video.url);
        }

        ffmpeg(videoPath)
          .seekInput(segment.startTime)
          .duration(segment.duration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size('1280x720')
          .outputOptions([
            '-crf', '23',
            '-preset', 'fast',
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero'
          ])
          .output(segmentPath)
          .on('progress', (progress) => {
            // Update progress for segment processing
            const segmentProgress = 15 + (index / segments.length) * 50 + (progress.percent || 0) / segments.length * 0.5;
            updateProgress(projectId, 'processing', Math.min(65, Math.round(segmentProgress)));
          })
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
          '-preset', 'fast'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Concat command:', commandLine);
          updateProgress(projectId, 'processing', 70);
        })
        .on('progress', (progress) => {
          // Update progress for concatenation
          const concatProgress = 70 + (progress.percent || 0) * 0.25;
          updateProgress(projectId, 'processing', Math.min(95, Math.round(concatProgress)));
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

// Helper function to update progress
async function updateProgress(projectId, status, progress) {
  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { status, progress }
    });
    console.log(`Project ${projectId}: ${status} - ${progress}%`);
  } catch (error) {
    console.error('Failed to update progress:', error);
  }
}

// Process jobs from the queue
videoQueue.process('process-video', async (job) => {
  const { projectId } = job.data;
  
  try {
    console.log(`Starting video processing for project: ${projectId}`);
    
    // Update project status
    await updateProgress(projectId, 'processing', 5);

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

    // Try multiple output directories for Railway compatibility
    const possibleOutputDirs = [
      path.join('/tmp', 'exports'),
      path.join(process.cwd(), 'tmp', 'exports'),
      path.join(process.cwd(), 'public', 'exports')
    ];

    let outputDir = null;
    let outputPath = null;

    // Try to create output directory in different locations
    for (const tryDir of possibleOutputDirs) {
      try {
        await fs.mkdir(tryDir, { recursive: true });
        // Test write permissions
        const testFile = path.join(tryDir, 'test.txt');
        await fs.writeFile(testFile, 'test');
        await fs.unlink(testFile);
        
        outputDir = tryDir;
        outputPath = path.join(tryDir, `${projectId}.mp4`);
        console.log(`Using output directory: ${outputDir}`);
        break;
      } catch (error) {
        console.log(`Cannot use directory: ${tryDir}`, error.message);
        continue;
      }
    }

    if (!outputPath) {
      throw new Error('Cannot create output directory in any location');
    }

    // Process the video with progress tracking
    await updateProgress(projectId, 'processing', 10);
    await processVideoWithBeats(project.inputVideos, project.beatMarkers, outputPath, projectId);

    // Verify file exists
    try {
      await fs.access(outputPath);
      console.log(`Output file created successfully: ${outputPath}`);
    } catch (error) {
      throw new Error(`Output file not created: ${outputPath}`);
    }

    // Update progress to near completion
    await updateProgress(projectId, 'processing', 95);

    // For now, serve the file directly
    const outputUrl = `/api/download/${projectId}`;

    // Update project with success
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'completed',
        progress: 100,
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
      data: { 
        status: 'error',
        progress: 0
      }
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