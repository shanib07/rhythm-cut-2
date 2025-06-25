// Server-side video processing utilities
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

interface ProgressCallback {
  (progress: number): void;
}

interface ProcessingJob {
  projectId: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
  message?: string;
  outputUrl?: string;
  error?: string;
}

/**
 * Upload a video file to the server
 */
export const uploadVideoFile = async (file: File): Promise<string> => {
  console.log(`📤 uploadVideoFile STARTED for: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
  
  const formData = new FormData();
  formData.append('file', file);
  
  console.log('🌐 Making POST request to /api/upload...');
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });
  
  console.log(`📨 Upload response status: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    console.log('❌ Upload failed, reading error response...');
    const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
    console.error('💥 Upload error data:', errorData);
    throw new Error(`Failed to upload video file: ${errorData.error || response.statusText}`);
  }
  
  const data = await response.json();
  console.log('✅ Upload successful, response data:', data);
  return data.url;
};

/**
 * Get video metadata using server-side processing
 */
export const getVideoMetadata = async (videoFile: File): Promise<VideoMetadata> => {
  // Create a video element to get basic metadata
  const videoEl = document.createElement('video');
  videoEl.src = URL.createObjectURL(videoFile);
  
  const metadata = await new Promise<VideoMetadata>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout loading video metadata'));
    }, 10000); // 10 second timeout

    videoEl.onloadedmetadata = () => {
      clearTimeout(timeout);
      resolve({
        duration: videoEl.duration,
        width: videoEl.videoWidth || 1920,
        height: videoEl.videoHeight || 1080,
        fps: 30 // Default FPS, server can provide more accurate value
      });
    };
    
    videoEl.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load video metadata - invalid or corrupted video file'));
    };
  });
  
  URL.revokeObjectURL(videoEl.src);
  return metadata;
};

/**
 * Process video on server with beat markers
 */
export const processVideoWithBeats = async (
  videos: { file: File; id: string }[],
  beatMarkers: number[],
  projectName: string = 'Video Processing',
  onProgress?: ProgressCallback
): Promise<string> => {
  try {
    console.log('🎬 processVideoWithBeats STARTED');
    console.log('Starting video processing with beats...');
    console.log(`Videos: ${videos.length}, Beat markers: ${beatMarkers.length}`);

    // Validate inputs
    if (!videos || videos.length === 0) {
      console.log('❌ No video files provided');
      throw new Error('No video files provided');
    }

    if (!beatMarkers || beatMarkers.length < 2) {
      console.log('❌ Need at least 2 beat markers');
      throw new Error('Need at least 2 beat markers to create video segments');
    }

    console.log('✅ Input validation passed');

    // Upload all video files first
    console.log('📤 Starting file upload phase...');
    onProgress?.(0.02);
    const uploadedVideos = [];
    
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      console.log(`📤 Uploading video ${i + 1}/${videos.length}: ${video.file.name} (${(video.file.size / 1024 / 1024).toFixed(2)}MB)`);
      
      try {
        console.log(`🌐 Making upload request to /api/upload for ${video.file.name}`);
        const serverUrl = await uploadVideoFile(video.file);
        console.log(`✅ Upload successful for ${video.file.name}, server URL: ${serverUrl}`);
        
        console.log(`📊 Getting metadata for ${video.file.name}...`);
        const metadata = await getVideoMetadata(video.file);
        console.log(`✅ Metadata retrieved: ${metadata.duration}s, ${metadata.width}x${metadata.height}`);
        
        uploadedVideos.push({
          id: video.id,
          url: serverUrl,
          duration: metadata.duration
        });
        
        // Update progress during upload phase (2-18%)
        const uploadProgress = (i + 1) / videos.length * 0.16 + 0.02;
        console.log(`📈 Upload progress: ${Math.round(uploadProgress * 100)}%`);
        onProgress?.(uploadProgress);
      } catch (uploadError) {
        const errorMessage = uploadError instanceof Error ? uploadError.message : 'Unknown upload error';
        console.error(`💥 Upload failed for ${video.file.name}:`, errorMessage);
        throw new Error(`Failed to upload video "${video.file.name}": ${errorMessage}`);
      }
    }

    console.log('✅ All videos uploaded successfully');
    console.log('📊 Uploaded videos summary:', uploadedVideos.map(v => ({ id: v.id, url: v.url, duration: v.duration })));

    // Start server-side processing
    console.log('🚀 Starting server-side processing...');
    onProgress?.(0.18);
    
    const requestBody = {
      name: projectName,
      inputVideos: uploadedVideos,
      beatMarkers: beatMarkers
    };
    
    console.log('📨 Making request to /api/process with body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch('/api/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('📨 /api/process response status:', response.status, response.statusText);

    if (!response.ok) {
      console.log('❌ /api/process request failed, reading error response...');
      const errorData = await response.json().catch(() => ({ error: 'Processing failed' }));
      console.error('💥 Processing API error:', errorData);
      throw new Error(`Server processing failed: ${errorData.error || errorData.details || response.statusText}`);
    }

    const responseData = await response.json();
    console.log('✅ /api/process response data:', responseData);
    
    const { success, projectId, error } = responseData;
    if (!success) {
      console.log('❌ Processing start failed:', error);
      throw new Error(`Failed to start processing: ${error || 'Unknown error'}`);
    }

    console.log(`🎯 Processing started successfully for project: ${projectId}`);
    onProgress?.(0.2);

    // Poll for progress with exponential backoff for errors
    console.log('🔄 Starting progress polling...');
    return new Promise((resolve, reject) => {
      let pollAttempts = 0;
      const maxAttempts = 360; // 6 minutes max (360 * 1000ms)
      const maxErrorAttempts = 5;
      let errorAttempts = 0;

      const pollProgress = async () => {
        try {
          pollAttempts++;
          
          if (pollAttempts > maxAttempts) {
            console.log('⏰ Polling timeout reached');
            reject(new Error('Processing timeout - the operation took too long'));
            return;
          }

          console.log(`🔄 Progress poll attempt ${pollAttempts}/${maxAttempts} for project ${projectId}`);
          const progressResponse = await fetch(`/api/progress/${projectId}`);
          
          if (!progressResponse.ok) {
            throw new Error(`Progress check failed: ${progressResponse.statusText}`);
          }

          const progressData: ProcessingJob = await progressResponse.json();
          
          console.log(`📊 Progress update: ${progressData.status} - ${progressData.progress}%`);
          console.log('📊 Full progress data:', progressData);

          // Update progress (20-100% for processing phase)
          if (onProgress && progressData.progress !== undefined) {
            const overallProgress = 0.2 + (progressData.progress / 100) * 0.8;
            onProgress(overallProgress);
          }

          if (progressData.status === 'completed' && progressData.outputUrl) {
            console.log('🎉 Processing completed successfully');
            console.log('📥 Final output URL:', progressData.outputUrl);
            resolve(progressData.outputUrl);
          } else if (progressData.status === 'error') {
            console.log('💥 Processing failed with error:', progressData.error);
            reject(new Error(`Video processing failed: ${progressData.error || 'Unknown processing error'}`));
          } else {
            // Reset error counter on successful poll
            errorAttempts = 0;
            // Continue polling with 1 second interval
            console.log(`⏳ Continuing to poll, next check in 1 second...`);
            setTimeout(pollProgress, 1000);
          }
        } catch (pollError) {
          errorAttempts++;
          console.warn(`🔄 Progress poll error (${errorAttempts}/${maxErrorAttempts}):`, pollError);
          
          if (errorAttempts >= maxErrorAttempts) {
            const errorMessage = pollError instanceof Error ? pollError.message : 'Unknown polling error';
            console.log('💥 Too many polling errors, giving up');
            reject(new Error(`Failed to check processing progress: ${errorMessage}`));
          } else {
            // Exponential backoff on errors
            const delay = Math.min(1000 * Math.pow(2, errorAttempts), 10000);
            console.log(`⏳ Retrying poll in ${delay}ms...`);
            setTimeout(pollProgress, delay);
          }
        }
      };

      console.log('🔄 Starting initial progress poll...');
      pollProgress();
    });

  } catch (error) {
    console.error('💥 processVideoWithBeats failed:', error);
    throw error;
  }
};

/**
 * Legacy function for trimming video (now uses server processing)
 */
export const trimVideo = async (
  videoFile: File,
  startTime: number,
  endTime: number,
  onProgress?: ProgressCallback
): Promise<string> => {
  const videos = [{ file: videoFile, id: 'single-video' }];
  const beatMarkers = [startTime, endTime];
  
  return processVideoWithBeats(
    videos,
    beatMarkers,
    'Video Trim',
    onProgress
  );
};

/**
 * Legacy function for concatenating videos (now uses server processing)
 */
export const concatenateVideos = async (
  videoFiles: File[],
  onProgress?: ProgressCallback
): Promise<string> => {
  const videos = videoFiles.map((file, index) => ({
    file,
    id: `video-${index}`
  }));
  
  // Create beat markers for simple concatenation (each video plays in full)
  const beatMarkers = [0];
  let currentTime = 0;
  
  for (const file of videoFiles) {
    const metadata = await getVideoMetadata(file);
    currentTime += metadata.duration;
    beatMarkers.push(currentTime);
  }
  
  return processVideoWithBeats(
    videos,
    beatMarkers,
    'Video Concatenation',
    onProgress
  );
};

/**
 * Legacy function for processing large video (now uses server processing)
 */
export const processLargeVideo = async (
  videoFile: File,
  operations: {
    startTime?: number;
    endTime?: number;
    targetWidth?: number;
    targetHeight?: number;
  },
  onProgress?: ProgressCallback
): Promise<string> => {
  const videos = [{ file: videoFile, id: 'large-video' }];
  const beatMarkers = [
    operations.startTime || 0,
    operations.endTime || (await getVideoMetadata(videoFile)).duration
  ];
  
  return processVideoWithBeats(
    videos,
    beatMarkers,
    'Large Video Processing',
    onProgress
  );
};

/**
 * Legacy function for processing video with options (now uses server processing)
 */
export async function processVideo(
  inputFile: File,
  options: {
    startTime?: number;
    duration?: number;
    width?: number;
    height?: number;
    onProgress?: (progress: number) => void;
  }
): Promise<string> {
  const videos = [{ file: inputFile, id: 'processed-video' }];
  const endTime = (options.startTime || 0) + (options.duration || (await getVideoMetadata(inputFile)).duration);
  const beatMarkers = [options.startTime || 0, endTime];
  
  return processVideoWithBeats(
    videos,
    beatMarkers,
    'Video Processing',
    options.onProgress
  );
}

/**
 * Generate thumbnail using server-side processing
 */
export async function generateThumbnail(
  inputFile: File,
  timeInSeconds: number
): Promise<string> {
  const formData = new FormData();
  formData.append('file', inputFile);
  formData.append('time', timeInSeconds.toString());
  
  const response = await fetch('/api/thumbnail', {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    throw new Error(`Failed to generate thumbnail: ${response.statusText}`);
  }
  
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * No cleanup needed for server-side processing
 */
export async function cleanupFFmpeg(): Promise<void> {
  // No browser-side resources to clean up
}

/**
 * Memory info not relevant for server-side processing
 */
export function getMemoryInfo(): { total: number; free: number } {
  return {
    total: Infinity,
    free: Infinity
  };
}

export function hasEnoughMemory(): boolean {
  return true; // Server handles memory management
}

export async function tryFreeMemory(): Promise<void> {
  // No-op for server-side processing
} 