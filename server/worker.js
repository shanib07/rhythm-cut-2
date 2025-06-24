const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs').promises;

const prisma = new PrismaClient();

// Create processing queue
const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

// Process videos based on beat markers
async function processVideoWithBeats(inputVideos, beatMarkers, outputPath) {
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

    // Process segments with limited concurrency and progress reporting
    const processSegmentBatch = async (segments, batchSize = 2) => {
      const results = [];
      for (let i = 0; i < segments.length; i += batchSize) {
        const batch = segments.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((segment, batchIndex) => {
            const index = i + batchIndex;
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
          })
        );
        results.push(...batchResults);
        
        // Update progress after each batch
        const progress = Math.round(((i + batch.length) / segments.length) * 70); // 70% for segment processing
        console.log(`Segment processing progress: ${progress}%`);
      }
      return results;
    };

    await processSegmentBatch(segments)
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

// Process jobs from the queue
videoQueue.process('process-video', async (job) => {
  const { projectId } = job.data;
  
  try {
    console.log(`Starting video processing for project: ${projectId}`);
    
    // Report initial progress
    job.progress(0);
    
    // Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'processing' }
    });
    
    job.progress(10);

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

    job.progress(20);

    // Process the video
    await processVideoWithBeats(project.inputVideos, project.beatMarkers, outputPath);
    
    job.progress(90);

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

    job.progress(100);
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