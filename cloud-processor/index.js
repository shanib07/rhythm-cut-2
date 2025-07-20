const express = require('express');
const { Storage } = require('@google-cloud/storage');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Google Cloud Storage
const storage = new Storage();
const inputBucket = storage.bucket(process.env.INPUT_BUCKET || 'rhythm-cut-inputs-466519');
const outputBucket = storage.bucket(process.env.OUTPUT_BUCKET || 'rhythm-cut-outputs-466519');
const tempBucket = storage.bucket(process.env.TEMP_BUCKET || 'rhythm-cut-temp-466519');

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'rhythm-cut-processor',
    version: '1.0.0'
  });
});

// Main processing endpoint
app.post('/process', async (req, res) => {
  const startTime = Date.now();
  const jobId = uuidv4();
  
  console.log(`🎬 Starting job ${jobId}`, {
    body: req.body,
    timestamp: new Date().toISOString()
  });

  try {
    const { inputVideos, beatMarkers, projectId, quality = 'balanced' } = req.body;

    if (!inputVideos || !beatMarkers || !projectId) {
      return res.status(400).json({
        error: 'Missing required parameters: inputVideos, beatMarkers, projectId'
      });
    }

    // Create temporary directory for processing
    const tempDir = path.join(os.tmpdir(), `rhythm-cut-${jobId}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Download input videos from Cloud Storage
    console.log(`📥 Downloading ${inputVideos.length} input videos`);
    const localVideoPaths = await Promise.all(
      inputVideos.map(async (video, index) => {
        const fileName = video.fileName || `video-${index}.mp4`;
        const localPath = path.join(tempDir, `input-${index}-${fileName}`);
        
        console.log(`📥 Downloading ${video.url} to ${localPath}`);
        await inputBucket.file(video.url).download({ destination: localPath });
        
        return { ...video, localPath };
      })
    );

    // Process video with beats
    console.log(`🎥 Processing video with ${beatMarkers.length} beat markers`);
    const outputFileName = `${projectId}-output.mp4`;
    const outputPath = path.join(tempDir, outputFileName);

    await processVideoWithBeats(localVideoPaths, beatMarkers, outputPath, quality);

    // Upload processed video to output bucket
    console.log(`📤 Uploading processed video to Cloud Storage`);
    const cloudOutputPath = `outputs/${projectId}/${outputFileName}`;
    await outputBucket.upload(outputPath, {
      destination: cloudOutputPath,
      metadata: {
        contentType: 'video/mp4',
      }
    });

    // Generate signed URL for download (valid for 1 hour)
    const [signedUrl] = await outputBucket.file(cloudOutputPath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    // Clean up temporary files
    console.log(`🧹 Cleaning up temporary files`);
    await fs.rm(tempDir, { recursive: true, force: true });

    const processingTime = Date.now() - startTime;
    console.log(`✅ Job ${jobId} completed in ${processingTime}ms`);

    res.json({
      success: true,
      jobId,
      outputUrl: signedUrl,
      processingTimeMs: processingTime
    });

  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error);
    res.status(500).json({
      error: 'Processing failed',
      message: error.message,
      jobId
    });
  }
});

// Video processing function (ported from worker.js)
async function processVideoWithBeats(inputVideos, beatMarkers, outputPath, quality) {
  return new Promise((resolve, reject) => {
    if (!inputVideos?.length || !beatMarkers?.length) {
      reject(new Error('Invalid input data'));
      return;
    }

    // Quality presets
    const qualitySettings = {
      fast: { crf: 30, preset: 'ultrafast', resolution: '1280x720' },
      balanced: { crf: 23, preset: 'fast', resolution: '1280x720' },
      high: { crf: 18, preset: 'medium', resolution: '1920x1080' }
    };

    const settings = qualitySettings[quality] || qualitySettings.balanced;
    
    // Create segments based on beat markers
    const segments = [];
    for (let i = 0; i < beatMarkers.length - 1; i++) {
      const videoIndex = i % inputVideos.length;
      const startTime = beatMarkers[i];
      const endTime = beatMarkers[i + 1];
      const duration = endTime - startTime;
      
      segments.push({
        video: inputVideos[videoIndex],
        startTime: 0,
        duration: duration,
        segmentIndex: i
      });
    }

    console.log(`📹 Processing ${segments.length} segments`);
    
    const tempDir = path.dirname(outputPath);
    const segmentPaths = [];

    // Process segments in parallel
    Promise.all(segments.map((segment, index) => {
      return new Promise((segResolve, segReject) => {
        const segmentPath = path.join(tempDir, `segment_${index}.mp4`);
        segmentPaths[index] = segmentPath;

        ffmpeg(segment.video.localPath)
          .seekInput(segment.startTime)
          .inputOptions(['-accurate_seek'])
          .duration(segment.duration)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size(settings.resolution)
          .outputOptions([
            '-crf', settings.crf.toString(),
            '-preset', settings.preset,
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            '-fflags', '+genpts',
            '-y'
          ])
          .on('end', () => {
            console.log(`✅ Segment ${index} completed`);
            segResolve(segmentPath);
          })
          .on('error', (error) => {
            console.error(`❌ Segment ${index} failed:`, error.message);
            segReject(error);
          })
          .save(segmentPath);
      });
    }))
    .then(async () => {
      // Create concat file
      const concatFilePath = path.join(tempDir, 'concat.txt');
      const concatContent = segmentPaths.map(p => `file '${p}'`).join('\n');
      await fs.writeFile(concatFilePath, concatContent, 'utf8');

      // Concatenate segments
      console.log('🎬 Concatenating segments');
      
      ffmpeg()
        .input(concatFilePath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('copy')
        .audioCodec('copy')
        .outputOptions(['-y'])
        .on('end', async () => {
          // Clean up segment files
          for (const segPath of segmentPaths) {
            await fs.unlink(segPath).catch(() => {});
          }
          await fs.unlink(concatFilePath).catch(() => {});
          
          console.log('✅ Video processing completed');
          resolve(outputPath);
        })
        .on('error', reject)
        .save(outputPath);
    })
    .catch(reject);
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Rhythm Cut processor running on port ${PORT}`);
  console.log('📦 Environment:', {
    inputBucket: process.env.INPUT_BUCKET || 'rhythm-cut-inputs-466519',
    outputBucket: process.env.OUTPUT_BUCKET || 'rhythm-cut-outputs-466519',
    tempBucket: process.env.TEMP_BUCKET || 'rhythm-cut-temp-466519'
  });
});