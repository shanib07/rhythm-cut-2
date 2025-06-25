const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs').promises;

const prisma = new PrismaClient();

// Create processing queue
const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

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

// Optimized video processing with beat markers - single pass, no gaps
async function processVideoWithBeats(inputVideos, beatMarkers, outputPath, projectId) {
  return new Promise((resolve, reject) => {
    console.log('Processing video with beats - OPTIMIZED VERSION');
    console.log(`Videos: ${inputVideos.length}, Beats: ${beatMarkers.length}`);
    
    if (!inputVideos || inputVideos.length === 0 || !beatMarkers || beatMarkers.length === 0) {
      reject(new Error('No input videos or beat markers provided'));
      return;
    }

    // Create segments based on beat markers with precise timing
    const segments = [];
    
    for (let i = 0; i < beatMarkers.length - 1; i++) {
      const videoIndex = i % inputVideos.length; // Cycle through videos
      const startTime = beatMarkers[i];
      const endTime = beatMarkers[i + 1];
      const duration = endTime - startTime;
      
      segments.push({
        video: inputVideos[videoIndex],
        startTime: 0, // Always start from beginning for rhythm cuts
        duration: duration,
        segmentIndex: i
      });
    }

    console.log(`Created ${segments.length} segments for processing`);

    const tempDir = path.dirname(outputPath);
    
    // Create concat demuxer file for gap-free concatenation
    const concatFilePath = path.join(tempDir, `concat_${Date.now()}.txt`);
    const segmentPaths = [];

    // Process segments with frame-accurate cutting to eliminate gaps
    Promise.all(segments.map((segment, index) => {
      return new Promise((segResolve, segReject) => {
        const segmentPath = path.join(tempDir, `segment_${index}_${Date.now()}.mp4`);
        segmentPaths.push(segmentPath);

        // Convert relative URL to absolute file path
        let videoPath = segment.video.url;
        if (videoPath.startsWith('/uploads/')) {
          videoPath = path.join(process.cwd(), 'public', segment.video.url);
        }

        console.log(`Processing segment ${index}: ${segment.duration.toFixed(3)}s from ${videoPath}`);

        // OPTIMIZED FFMPEG COMMAND - No gaps, frame-accurate cutting
        ffmpeg(videoPath)
          .seekInput(segment.startTime) // Seek before input for precision
          .inputOptions([
            '-accurate_seek' // Enable accurate seeking
          ])
          .duration(segment.duration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size('1280x720')
          .outputOptions([
            '-crf', '23',           // Good quality
            '-preset', 'fast',      // Fast encoding
            '-threads', '0',        // Use all CPU cores
            '-movflags', '+faststart', // Web-optimized
            '-avoid_negative_ts', 'make_zero', // Fix timestamp issues
            '-fflags', '+genpts',   // Generate proper timestamps
            '-vsync', 'cfr',        // Constant frame rate
            '-async', '1',          // Audio sync
            '-copyts',              // Copy timestamps for precision
            '-start_at_zero'        // Start timestamps at zero
          ])
          .output(segmentPath)
          .on('start', (commandLine) => {
            console.log(`Segment ${index} FFmpeg command:`, commandLine);
          })
          .on('progress', (progress) => {
            const segmentProgress = 10 + (index / segments.length) * 60 + (progress.percent || 0) / segments.length * 0.6;
            updateProgress(projectId, 'processing', Math.min(70, Math.round(segmentProgress)));
          })
          .on('end', () => {
            console.log(`Segment ${index} completed successfully`);
            segResolve(segmentPath);
          })
          .on('error', (error) => {
            console.error(`Segment ${index} failed:`, error);
            segReject(error);
          })
          .run();
      });
    }))
    .then(async () => {
      console.log('All segments processed, creating concat file...');
      
      // Create concat demuxer file for seamless concatenation
      const concatContent = segmentPaths.map(path => `file '${path}'`).join('\n');
      await fs.writeFile(concatFilePath, concatContent, 'utf8');
      
      console.log('Concat file created, starting final concatenation...');
      updateProgress(projectId, 'processing', 75);

      // OPTIMIZED CONCATENATION - Single pass, no re-encoding gaps
      ffmpeg()
        .input(concatFilePath)
        .inputOptions([
          '-f', 'concat',         // Use concat demuxer
          '-safe', '0'            // Allow absolute paths
        ])
        .videoCodec('copy')       // Copy without re-encoding (faster, no quality loss)
        .audioCodec('copy')       // Copy without re-encoding
        .outputOptions([
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Final concat command:', commandLine);
        })
        .on('progress', (progress) => {
          const concatProgress = 75 + (progress.percent || 0) * 0.2;
          updateProgress(projectId, 'processing', Math.min(95, Math.round(concatProgress)));
        })
        .on('end', async () => {
          console.log('Final concatenation completed successfully');
          
          // Clean up temporary files
          try {
            await fs.unlink(concatFilePath);
            for (const segPath of segmentPaths) {
              await fs.unlink(segPath);
            }
            console.log('Temporary files cleaned up');
          } catch (cleanupError) {
            console.warn('Some temporary files could not be cleaned up:', cleanupError);
          }
          
          resolve(outputPath);
        })
        .on('error', async (error) => {
          console.error('Final concatenation failed:', error);
          
          // Clean up on error
          try {
            await fs.unlink(concatFilePath);
            for (const segPath of segmentPaths) {
              await fs.unlink(segPath);
            }
          } catch (cleanupError) {
            console.warn('Could not clean up after error:', cleanupError);
          }
          
          reject(error);
        })
        .run();
    })
    .catch(reject);
  });
}

// Process jobs from the queue
videoQueue.process('process-video', async (job) => {
  const { projectId } = job.data;
  
  try {
    console.log(`Starting OPTIMIZED video processing for project: ${projectId}`);
    
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
      beatMarkers: project.beatMarkers?.length,
      projectName: project.name
    });

    // Validate project data
    if (!project.inputVideos || !Array.isArray(project.inputVideos) || project.inputVideos.length === 0) {
      throw new Error('No input videos found in project');
    }

    if (!project.beatMarkers || !Array.isArray(project.beatMarkers) || project.beatMarkers.length < 2) {
      throw new Error('Need at least 2 beat markers to create video segments');
    }

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

    // Process the video with optimized settings
    await updateProgress(projectId, 'processing', 10);
    await processVideoWithBeats(project.inputVideos, project.beatMarkers, outputPath, projectId);

    // Verify file exists and has reasonable size
    try {
      const stats = await fs.stat(outputPath);
      console.log(`Output file created: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      
      if (stats.size < 1000) { // Less than 1KB is suspicious
        throw new Error('Output file is too small, processing may have failed');
      }
    } catch (error) {
      throw new Error(`Output file verification failed: ${error.message}`);
    }

    // Update progress to completion
    await updateProgress(projectId, 'processing', 98);

    // Set up download URL
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

    console.log(`OPTIMIZED video processing completed for project: ${projectId}`);
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

// Handle failed jobs with better logging
videoQueue.on('failed', async (job, error) => {
  console.error(`Job ${job.id} failed for project ${job.data?.projectId}:`, error);
  
  // Update project status on failure
  if (job.data.projectId) {
    try {
      await prisma.project.update({
        where: { id: job.data.projectId },
        data: { 
          status: 'error',
          progress: 0
        }
      });
    } catch (updateError) {
      console.error('Failed to update project status:', updateError);
    }
  }
});

// Add job completion logging
videoQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully for project ${job.data?.projectId}`);
});

console.log('OPTIMIZED video processing worker is running...'); 