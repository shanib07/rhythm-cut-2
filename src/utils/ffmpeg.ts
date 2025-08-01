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
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(`Failed to upload video file: ${errorData.error || response.statusText}`);
  }
  
  const data = await response.json();
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
  console.log('🚀 PROCESS: Starting processVideoWithBeats', {
    videosCount: videos.length,
    beatMarkersCount: beatMarkers.length,
    projectName,
    timestamp: new Date().toISOString()
  });

  try {
    // Validate inputs
    if (!videos || videos.length === 0) {
      throw new Error('No video files provided');
    }

    if (!beatMarkers || beatMarkers.length < 2) {
      throw new Error('Need at least 2 beat markers to create video segments');
    }

    console.log('🚀 PROCESS: Input validation passed', {
      videos: videos.map(v => ({ id: v.id, fileName: v.file.name, fileSize: v.file.size })),
      beatMarkers
    });

    // Upload all video files first
    console.log('🚀 PROCESS: Starting video uploads...');
    onProgress?.(0.02);
    const uploadedVideos = [];
    
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      console.log(`🚀 PROCESS: Uploading video ${i + 1}/${videos.length}`, {
        videoId: video.id,
        fileName: video.file.name,
        fileSize: video.file.size
      });
      
      try {
        const uploadStartTime = Date.now();
        const serverUrl = await uploadVideoFile(video.file);
        const uploadTime = Date.now() - uploadStartTime;
        
        console.log(`🚀 PROCESS: Video ${i + 1} uploaded successfully`, {
          videoId: video.id,
          serverUrl,
          uploadTimeMs: uploadTime
        });
        
        const metadata = await getVideoMetadata(video.file);
        
        uploadedVideos.push({
          id: video.id,
          url: serverUrl,
          duration: metadata.duration
        });
        
        // Update progress during upload phase (2-18%)
        onProgress?.((i + 1) / videos.length * 0.16 + 0.02);
      } catch (uploadError) {
        const errorMessage = uploadError instanceof Error ? uploadError.message : 'Unknown upload error';
        console.error(`🚀 PROCESS: Upload failed for video ${i + 1}`, {
          videoId: video.id,
          fileName: video.file.name,
          error: errorMessage
        });
        throw new Error(`Failed to upload video "${video.file.name}": ${errorMessage}`);
      }
    }

    console.log('🚀 PROCESS: All videos uploaded successfully', {
      uploadedCount: uploadedVideos.length,
      totalDuration: uploadedVideos.reduce((sum, v) => sum + v.duration, 0).toFixed(2)
    });

    // Start server-side processing
    console.log('🚀 PROCESS: Starting server-side processing request...');
    onProgress?.(0.18);
    
    const apiRequestStartTime = Date.now();
    const response = await fetch('/api/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: projectName,
        inputVideos: uploadedVideos,
        beatMarkers: beatMarkers
      })
    });

    const apiRequestTime = Date.now() - apiRequestStartTime;
    console.log('🚀 PROCESS: API request completed', {
      responseStatus: response.status,
      responseOk: response.ok,
      requestTimeMs: apiRequestTime
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Processing failed' }));
      console.error('🚀 PROCESS: API request failed', {
        status: response.status,
        statusText: response.statusText,
        errorData
      });
      throw new Error(`Server processing failed: ${errorData.error || errorData.details || response.statusText}`);
    }

    const { success, projectId, error } = await response.json();
    if (!success) {
      console.error('🚀 PROCESS: Server rejected processing request', { error });
      throw new Error(`Failed to start processing: ${error || 'Unknown error'}`);
    }

    console.log('🚀 PROCESS: Processing started successfully', {
      projectId,
      timestamp: new Date().toISOString()
    });
    onProgress?.(0.2);

    // Poll for progress with exponential backoff for errors
    console.log('🚀 PROCESS: Starting progress polling...');
    return new Promise((resolve, reject) => {
      let pollAttempts = 0;
      const maxAttempts = 360; // 6 minutes max (360 * 1000ms)
      const maxErrorAttempts = 5;
      let errorAttempts = 0;
      let lastProgress = 0;
      let stuckCounter = 0;
      const maxStuckPolls = 30; // If progress doesn't change for 30 polls (30 seconds), consider it stuck

      const pollProgress = async () => {
        try {
          pollAttempts++;
          
          if (pollAttempts > maxAttempts) {
            console.error('🚀 PROCESS: Polling timeout exceeded', {
              projectId,
              pollAttempts,
              maxAttempts,
              lastProgress
            });
            reject(new Error('Processing timeout - the operation took too long'));
            return;
          }

          console.log(`🚀 PROCESS: Polling attempt ${pollAttempts}`, {
            projectId,
            errorAttempts,
            lastProgress
          });

          const progressResponse = await fetch(`/api/progress/${projectId}`);
          
          if (!progressResponse.ok) {
            throw new Error(`Progress check failed: ${progressResponse.statusText}`);
          }

          const progressData: ProcessingJob = await progressResponse.json();
          
          console.log('🚀 PROCESS: Progress update received', {
            projectId,
            status: progressData.status,
            progress: progressData.progress,
            message: progressData.message,
            pollAttempt: pollAttempts
          });

          // Check for stuck progress
          if (progressData.progress === lastProgress) {
            stuckCounter++;
            if (stuckCounter >= maxStuckPolls) {
              console.error('🚀 PROCESS: Progress appears stuck', {
                projectId,
                stuckCounter,
                lastProgress,
                currentStatus: progressData.status
              });
              
              // Try to get more detailed job status
              try {
                const jobStatusResponse = await fetch(`/api/job-status/${projectId}`);
                if (jobStatusResponse.ok) {
                  const jobStatus = await jobStatusResponse.json();
                  console.log('🚀 PROCESS: Detailed job status', { jobStatus });
                }
              } catch (jobError) {
                console.warn('🚀 PROCESS: Could not get detailed job status', { 
                  error: jobError instanceof Error ? jobError.message : 'Unknown error' 
                });
              }
              
              reject(new Error(`Processing appears stuck at ${lastProgress}% for 30+ seconds`));
              return;
            }
          } else {
            stuckCounter = 0; // Reset stuck counter if progress changed
            lastProgress = progressData.progress || 0;
          }

          // Update progress (20-100% for processing phase)
          if (onProgress && progressData.progress !== undefined) {
            onProgress(0.2 + (progressData.progress / 100) * 0.8);
          }

          if (progressData.status === 'completed' && progressData.outputUrl) {
            console.log('🚀 PROCESS: Processing completed successfully', {
              projectId,
              outputUrl: progressData.outputUrl,
              totalPollAttempts: pollAttempts,
              totalTimeMs: pollAttempts * 1000
            });
            resolve(progressData.outputUrl);
          } else if (progressData.status === 'error') {
            console.error('🚀 PROCESS: Processing failed on server', {
              projectId,
              error: progressData.error,
              pollAttempts
            });
            reject(new Error(`Video processing failed: ${progressData.error || 'Unknown processing error'}`));
          } else {
            // Reset error counter on successful poll
            errorAttempts = 0;
            // Continue polling with 1 second interval
            setTimeout(pollProgress, 1000);
          }
        } catch (pollError) {
          errorAttempts++;
          const errorMessage = pollError instanceof Error ? pollError.message : 'Unknown polling error';
          console.warn('🚀 PROCESS: Progress poll error', {
            projectId,
            errorAttempts,
            maxErrorAttempts,
            error: errorMessage,
            pollAttempt: pollAttempts
          });
          
          if (errorAttempts >= maxErrorAttempts) {
            console.error('🚀 PROCESS: Too many polling errors', {
              projectId,
              errorAttempts,
              lastError: errorMessage
            });
            reject(new Error(`Failed to check processing progress: ${errorMessage}`));
          } else {
            // Exponential backoff on errors
            const delay = Math.min(1000 * Math.pow(2, errorAttempts), 10000);
            console.log('🚀 PROCESS: Retrying poll after delay', {
              projectId,
              delayMs: delay,
              attempt: errorAttempts
            });
            setTimeout(pollProgress, delay);
          }
        }
      };

      pollProgress();
    });

  } catch (error) {
    console.error('🚀 PROCESS: processVideoWithBeats failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
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

/**
 * Direct video processing (bypasses queue for faster processing)
 */
export const processVideoWithBeatsDirect = async (
  videos: { file: File; id: string }[],
  beatMarkers: number[],
  audioFile: File,
  projectName: string = 'Video Processing',
  quality: 'fast' | 'balanced' | 'high' = 'balanced',
  onProgress?: ProgressCallback
): Promise<string> => {
  console.log('🚀 DIRECT: Starting direct video processing', {
    videosCount: videos.length,
    beatMarkersCount: beatMarkers.length,
    audioFileName: audioFile.name,
    quality,
    timestamp: new Date().toISOString()
  });

  try {
    // Validate inputs
    if (!videos || videos.length === 0) {
      throw new Error('No video files provided');
    }

    if (!beatMarkers || beatMarkers.length < 2) {
      throw new Error('Need at least 2 beat markers to create video segments');
    }

    if (!audioFile) {
      throw new Error('Audio file is required');
    }

    // Upload all video files in parallel (0-20%)
    console.log('🚀 DIRECT: Uploading videos in parallel...');
    onProgress?.(0.05);
    
    const uploadPromises = videos.map(async (video, index) => {
      console.log(`🚀 DIRECT: Starting upload for video ${index + 1}/${videos.length}`);
      
      try {
        const [serverUrl, metadata] = await Promise.all([
          uploadVideoFile(video.file),
          getVideoMetadata(video.file)
        ]);
        
        console.log(`🚀 DIRECT: Video ${index + 1} uploaded successfully`);
        
        return {
          id: video.id,
          url: serverUrl,
          duration: metadata.duration
        };
      } catch (error) {
        console.error(`🚀 DIRECT: Upload failed for video ${index + 1}:`, error);
        throw new Error(`Failed to upload video ${index + 1}: ${video.file.name}`);
      }
    });
    
    const uploadedVideos = await Promise.all(uploadPromises);
    onProgress?.(0.20); // 20% when all uploads complete

    // Upload audio file (20-25%)
    console.log('🚀 DIRECT: Uploading audio file...');
    onProgress?.(0.20);
    const audioUrl = await uploadVideoFile(audioFile);
    onProgress?.(0.25);
    
    console.log('🚀 DIRECT: Starting direct processing...');
    onProgress?.(0.30);

    // Call direct processing endpoint
    const startProcessingTime = Date.now();
    
    // Estimate processing time based on video count and quality
    const segmentCount = beatMarkers.length - 1;
    const estimatedTimePerSegment = quality === 'fast' ? 1000 : quality === 'balanced' ? 2000 : 3000;
    const estimatedTotalTime = segmentCount * estimatedTimePerSegment + 5000; // Add 5s for concat/audio
    
    // Create a promise for the fetch request
    const fetchPromise = fetch('/api/process-direct', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: projectName,
        inputVideos: uploadedVideos,
        beatMarkers: beatMarkers,
        audioUrl: audioUrl,
        quality: quality
      })
    });

    // Create a promise for progress simulation
    const progressPromise = new Promise<void>((resolve) => {
      let progress = 0.30;
      const progressInterval = setInterval(() => {
        // Simulate progress from 30% to 85%
        progress += (0.55 / (estimatedTotalTime / 1000)) * 2; // Update every 2 seconds
        if (progress > 0.85) {
          progress = 0.85;
          clearInterval(progressInterval);
          resolve();
        }
        
        console.log(`🚀 DIRECT: Progress simulation: ${Math.round(progress * 100)}%`);
        onProgress?.(progress);
      }, 2000);
      
      // Ensure we stop the interval after max time
      setTimeout(() => {
        clearInterval(progressInterval);
        resolve();
      }, estimatedTotalTime);
    });

    // Add timeout for the fetch request (5 minutes max)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Processing timeout: Export took longer than 5 minutes`));
      }, 5 * 60 * 1000); // 5 minutes
    });

    let response: Response;
    
    try {
      // Wait for fetch to complete, with timeout
      response = await Promise.race([fetchPromise, timeoutPromise]);
      
      // Cancel progress simulation if still running
      await progressPromise;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Processing failed' }));
        const errorMessage = errorData.error || errorData.details || response.statusText;
        
        // Provide more helpful error messages
        if (response.status === 413) {
          throw new Error('Video files are too large. Try using lower quality or shorter clips.');
        } else if (response.status === 500) {
          throw new Error(`Server processing error: ${errorMessage}. Try using "Fast Export" mode.`);
        } else {
          throw new Error(`Direct processing failed: ${errorMessage}`);
        }
      }
    } catch (error) {
      // Handle timeout or other errors
      if (error instanceof Error && error.message.includes('timeout')) {
        console.error('🚀 DIRECT: Processing timeout detected');
        throw new Error('Export is taking too long. Try using "Fast Export" for quicker results.');
      }
      throw error;
    }

    // Update to 90% when response received
    onProgress?.(0.90);

    const { success, outputUrl, processingTime, details } = await response.json();
    
    if (!success) {
      throw new Error('Direct processing failed');
    }

    const totalProcessingTime = Date.now() - startProcessingTime;
    console.log('🚀 DIRECT: Processing completed', {
      outputUrl,
      processingTimeMs: processingTime,
      totalTimeMs: totalProcessingTime,
      method: quality,
      details: details || {}
    });

    // Complete progress
    onProgress?.(1.0);
    return outputUrl;

  } catch (error) {
    console.error('🚀 DIRECT: Processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}; 