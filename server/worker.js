const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs').promises;

const prisma = new PrismaClient();

// Create processing queue with detailed logging
console.log('📋 WORKER: Initializing video processing queue...', {
  redisUrl: process.env.REDIS_URL ? 'Set' : 'Not set',
  timestamp: new Date().toISOString()
});

const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

// Test Redis connection on startup
videoQueue.on('ready', () => {
  console.log('📋 WORKER: Queue ready and connected to Redis', {
    queueName: videoQueue.name,
    timestamp: new Date().toISOString()
  });
});

videoQueue.on('error', (error) => {
  console.error('📋 WORKER: Queue error', {
    error: error.message,
    timestamp: new Date().toISOString()
  });
});

// Helper function to update progress
async function updateProgress(projectId, status, progress) {
  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { status, progress }
    });
    console.log(`📈 PROGRESS: Project ${projectId} - ${status} - ${progress}%`);
  } catch (error) {
    console.error('📈 PROGRESS: Failed to update progress', {
      projectId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Optimized video processing with beat markers - single pass, no gaps
async function processVideoWithBeats(inputVideos, beatMarkers, outputPath, projectId) {
  console.log('🎥 FFMPEG: Starting video processing', {
    projectId,
    inputVideosCount: inputVideos.length,
    beatMarkersCount: beatMarkers.length,
    outputPath,
    timestamp: new Date().toISOString()
  });

  return new Promise((resolve, reject) => {
    const processingStartTime = Date.now();
    
    if (!inputVideos || inputVideos.length === 0 || !beatMarkers || beatMarkers.length === 0) {
      const error = new Error('No input videos or beat markers provided');
      console.error('🎥 FFMPEG: Invalid input data', {
        projectId,
        inputVideosCount: inputVideos?.length || 0,
        beatMarkersCount: beatMarkers?.length || 0
      });
      reject(error);
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

    console.log('🎥 FFMPEG: Created segments for processing', {
      projectId,
      segmentsCount: segments.length,
      segments: segments.map((s, i) => ({
        index: i,
        videoUrl: s.video.url,
        duration: s.duration.toFixed(3)
      }))
    });

    const tempDir = path.dirname(outputPath);
    
    // Create concat demuxer file for gap-free concatenation
    const concatFilePath = path.join(tempDir, `concat_${Date.now()}_${projectId}.txt`);
    const segmentPaths = [];

    // Add timeout for the entire processing
    const processingTimeout = setTimeout(() => {
      console.error('🎥 FFMPEG: Processing timeout exceeded', {
        projectId,
        timeoutMinutes: 5,
        processingTimeMs: Date.now() - processingStartTime
      });
      reject(new Error('Video processing timeout (5 minutes exceeded)'));
    }, 5 * 60 * 1000); // 5 minute timeout

    // Process segments with frame-accurate cutting to eliminate gaps
    Promise.all(segments.map((segment, index) => {
      return new Promise((segResolve, segReject) => {
        const segmentStartTime = Date.now();
        const segmentPath = path.join(tempDir, `segment_${index}_${Date.now()}_${projectId}.mp4`);
        segmentPaths.push(segmentPath);

        // Convert relative URL to absolute file path
        let videoPath = segment.video.url;
        if (videoPath.startsWith('/uploads/')) {
          videoPath = path.join(process.cwd(), 'public', segment.video.url);
        }

        console.log(`🎥 FFMPEG: Processing segment ${index}`, {
          projectId,
          segmentIndex: index,
          duration: segment.duration.toFixed(3),
          inputPath: videoPath,
          outputPath: segmentPath,
          timestamp: new Date().toISOString()
        });

        // Check if input file exists
        fs.access(videoPath).then(() => {
          console.log(`🎥 FFMPEG: Input file accessible for segment ${index}`, { videoPath });
        }).catch((accessError) => {
          console.error(`🎥 FFMPEG: Input file not accessible for segment ${index}`, {
            videoPath,
            error: accessError.message
          });
          segReject(new Error(`Input file not accessible: ${videoPath}`));
          return;
        });

        // OPTIMIZED FFMPEG COMMAND - No gaps, frame-accurate cutting
        const ffmpegCommand = ffmpeg(videoPath)
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
            '-start_at_zero',       // Start timestamps at zero
            '-y'                    // Overwrite output files
          ])
          .output(segmentPath);

        // Add segment timeout
        const segmentTimeout = setTimeout(() => {
          console.error(`🎥 FFMPEG: Segment ${index} timeout`, {
            projectId,
            segmentIndex: index,
            processingTimeMs: Date.now() - segmentStartTime
          });
          ffmpegCommand.kill('SIGKILL');
          segReject(new Error(`Segment ${index} processing timeout`));
        }, 2 * 60 * 1000); // 2 minute timeout per segment

        ffmpegCommand
          .on('start', (commandLine) => {
            console.log(`🎥 FFMPEG: Segment ${index} command started`, {
              projectId,
              segmentIndex: index,
              command: commandLine,
              timestamp: new Date().toISOString()
            });
          })
          .on('progress', (progress) => {
            console.log(`🎥 FFMPEG: Segment ${index} progress`, {
              projectId,
              segmentIndex: index,
              progress: `${(progress.percent || 0).toFixed(1)}%`,
              timemark: progress.timemark,
              targetSize: progress.targetSize
            });
            
            const segmentProgress = 10 + (index / segments.length) * 60 + (progress.percent || 0) / segments.length * 0.6;
            updateProgress(projectId, 'processing', Math.min(70, Math.round(segmentProgress)));
          })
          .on('end', () => {
            clearTimeout(segmentTimeout);
            const segmentProcessingTime = Date.now() - segmentStartTime;
            console.log(`🎥 FFMPEG: Segment ${index} completed successfully`, {
              projectId,
              segmentIndex: index,
              outputPath: segmentPath,
              processingTimeMs: segmentProcessingTime,
              timestamp: new Date().toISOString()
            });
            segResolve(segmentPath);
          })
          .on('error', (error) => {
            clearTimeout(segmentTimeout);
            const segmentProcessingTime = Date.now() - segmentStartTime;
            console.error(`🎥 FFMPEG: Segment ${index} failed`, {
              projectId,
              segmentIndex: index,
              error: error.message,
              processingTimeMs: segmentProcessingTime,
              timestamp: new Date().toISOString()
            });
            segReject(error);
          })
          .run();
      });
    }))
    .then(async () => {
      console.log('🎥 FFMPEG: All segments processed, creating concat file', {
        projectId,
        segmentPathsCount: segmentPaths.length,
        concatFilePath
      });
      
      // Create concat demuxer file for seamless concatenation
      const concatContent = segmentPaths.map(path => `file '${path}'`).join('\n');
      await fs.writeFile(concatFilePath, concatContent, 'utf8');
      
      console.log('🎥 FFMPEG: Concat file created, starting final concatenation', {
        projectId,
        concatContent
      });
      updateProgress(projectId, 'processing', 75);

      // OPTIMIZED CONCATENATION - Single pass, no re-encoding gaps
      const finalCommand = ffmpeg()
        .input(concatFilePath)
        .inputOptions([
          '-f', 'concat',         // Use concat demuxer
          '-safe', '0'            // Allow absolute paths
        ])
        .videoCodec('copy')       // Copy without re-encoding (faster, no quality loss)
        .audioCodec('copy')       // Copy without re-encoding
        .outputOptions([
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts',
          '-y'                    // Overwrite output files
        ])
        .output(outputPath);

      // Add final concatenation timeout
      const concatTimeout = setTimeout(() => {
        console.error('🎥 FFMPEG: Final concatenation timeout', {
          projectId,
          processingTimeMs: Date.now() - processingStartTime
        });
        finalCommand.kill('SIGKILL');
        reject(new Error('Final concatenation timeout'));
      }, 2 * 60 * 1000); // 2 minute timeout for concatenation

      finalCommand
        .on('start', (commandLine) => {
          console.log('🎥 FFMPEG: Final concatenation started', {
            projectId,
            command: commandLine,
            timestamp: new Date().toISOString()
          });
        })
        .on('progress', (progress) => {
          console.log('🎥 FFMPEG: Final concatenation progress', {
            projectId,
            progress: `${(progress.percent || 0).toFixed(1)}%`,
            timemark: progress.timemark
          });
          
          const concatProgress = 75 + (progress.percent || 0) * 0.2;
          updateProgress(projectId, 'processing', Math.min(95, Math.round(concatProgress)));
        })
        .on('end', async () => {
          clearTimeout(concatTimeout);
          clearTimeout(processingTimeout);
          
          const totalProcessingTime = Date.now() - processingStartTime;
          console.log('🎥 FFMPEG: Final concatenation completed successfully', {
            projectId,
            outputPath,
            totalProcessingTimeMs: totalProcessingTime,
            timestamp: new Date().toISOString()
          });
          
          // Clean up temporary files
          try {
            await fs.unlink(concatFilePath);
            for (const segPath of segmentPaths) {
              await fs.unlink(segPath);
            }
            console.log('🎥 FFMPEG: Temporary files cleaned up', {
              projectId,
              filesRemoved: segmentPaths.length + 1
            });
          } catch (cleanupError) {
            console.warn('🎥 FFMPEG: Some temporary files could not be cleaned up', {
              projectId,
              error: cleanupError.message
            });
          }
          
          resolve(outputPath);
        })
        .on('error', async (error) => {
          clearTimeout(concatTimeout);
          clearTimeout(processingTimeout);
          
          const totalProcessingTime = Date.now() - processingStartTime;
          console.error('🎥 FFMPEG: Final concatenation failed', {
            projectId,
            error: error.message,
            totalProcessingTimeMs: totalProcessingTime,
            timestamp: new Date().toISOString()
          });
          
          // Clean up on error
          try {
            await fs.unlink(concatFilePath);
            for (const segPath of segmentPaths) {
              await fs.unlink(segPath);
            }
          } catch (cleanupError) {
            console.warn('🎥 FFMPEG: Could not clean up after error', {
              projectId,
              error: cleanupError.message
            });
          }
          
          reject(error);
        })
        .run();
    })
    .catch((error) => {
      clearTimeout(processingTimeout);
      console.error('🎥 FFMPEG: Segment processing failed', {
        projectId,
        error: error.message,
        processingTimeMs: Date.now() - processingStartTime
      });
      reject(error);
    });
  });
}

// Process jobs from the queue
videoQueue.process('process-video', async (job) => {
  const { projectId } = job.data;
  const jobStartTime = Date.now();
  
  console.log('⚙️ WORKER: Starting job processing', {
    jobId: job.id,
    projectId,
    jobData: job.data,
    timestamp: new Date().toISOString()
  });
  
  try {
    // Update project status
    await updateProgress(projectId, 'processing', 5);

    // Get project details
    console.log('⚙️ WORKER: Fetching project from database', { projectId });
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project) {
      throw new Error('Project not found');
    }

    console.log('⚙️ WORKER: Project loaded successfully', {
      projectId,
      projectName: project.name,
      inputVideosCount: project.inputVideos?.length || 0,
      beatMarkersCount: project.beatMarkers?.length || 0,
      status: project.status
    });

    // Validate project data
    if (!project.inputVideos || !Array.isArray(project.inputVideos) || project.inputVideos.length === 0) {
      throw new Error('No input videos found in project');
    }

    if (!project.beatMarkers || !Array.isArray(project.beatMarkers) || project.beatMarkers.length < 2) {
      throw new Error('Need at least 2 beat markers to create video segments');
    }

    // Try multiple output directories for Railway compatibility
    console.log('⚙️ WORKER: Setting up output directory');
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
        console.log('⚙️ WORKER: Output directory confirmed', {
          projectId,
          outputDir,
          outputPath
        });
        break;
      } catch (error) {
        console.log('⚙️ WORKER: Cannot use directory', {
          directory: tryDir,
          error: error.message
        });
        continue;
      }
    }

    if (!outputPath) {
      throw new Error('Cannot create output directory in any location');
    }

    // Process the video with optimized settings
    console.log('⚙️ WORKER: Starting video processing', { projectId });
    await updateProgress(projectId, 'processing', 10);
    await processVideoWithBeats(project.inputVideos, project.beatMarkers, outputPath, projectId);

    // Verify file exists and has reasonable size
    console.log('⚙️ WORKER: Verifying output file', { outputPath });
    try {
      const stats = await fs.stat(outputPath);
      console.log('⚙️ WORKER: Output file verified', {
        projectId,
        outputPath,
        fileSizeMB: (stats.size / 1024 / 1024).toFixed(2),
        fileSizeBytes: stats.size
      });
      
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
    console.log('⚙️ WORKER: Updating project status to completed', { projectId });
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'completed',
        progress: 100,
        outputUrl
      }
    });

    const totalJobTime = Date.now() - jobStartTime;
    console.log('⚙️ WORKER: Job completed successfully', {
      jobId: job.id,
      projectId,
      outputUrl,
      totalProcessingTimeMs: totalJobTime,
      timestamp: new Date().toISOString()
    });
    
    return { success: true, outputUrl };

  } catch (error) {
    const totalJobTime = Date.now() - jobStartTime;
    console.error('⚙️ WORKER: Job processing failed', {
      jobId: job.id,
      projectId,
      error: error.message,
      stack: error.stack,
      totalProcessingTimeMs: totalJobTime,
      timestamp: new Date().toISOString()
    });
    
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
  console.error('⚙️ WORKER: Job failed', {
    jobId: job.id,
    projectId: job.data?.projectId,
    error: error.message,
    attempts: job.attemptsMade,
    maxAttempts: job.opts.attempts,
    timestamp: new Date().toISOString()
  });
  
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
      console.error('⚙️ WORKER: Failed to update project status on job failure', {
        projectId: job.data.projectId,
        error: updateError.message
      });
    }
  }
});

// Add job completion logging
videoQueue.on('completed', (job) => {
  console.log('⚙️ WORKER: Job completed successfully', {
    jobId: job.id,
    projectId: job.data?.projectId,
    returnValue: job.returnvalue,
    timestamp: new Date().toISOString()
  });
});

// Add job progress logging
videoQueue.on('progress', (job, progress) => {
  console.log('⚙️ WORKER: Job progress update', {
    jobId: job.id,
    projectId: job.data?.projectId,
    progress: `${progress}%`
  });
});

console.log('⚙️ WORKER: OPTIMIZED video processing worker is running...', {
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'development'
}); 