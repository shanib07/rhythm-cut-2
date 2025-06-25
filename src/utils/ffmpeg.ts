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
    throw new Error('Failed to upload video file');
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
    videoEl.onloadedmetadata = () => {
      resolve({
        duration: videoEl.duration,
        width: videoEl.videoWidth || 1920,
        height: videoEl.videoHeight || 1080,
        fps: 30 // Default FPS, server can provide more accurate value
      });
    };
    videoEl.onerror = () => reject(new Error('Failed to load video metadata'));
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
  // Upload all video files first
  const uploadedVideos = [];
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const serverUrl = await uploadVideoFile(video.file);
    const metadata = await getVideoMetadata(video.file);
    
    uploadedVideos.push({
      id: video.id,
      url: serverUrl,
      duration: metadata.duration
    });
    
    // Update progress during upload phase (0-20%)
    onProgress?.((i + 1) / videos.length * 0.2);
  }

  // Start server-side processing
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

  if (!response.ok) {
    throw new Error('Failed to start video processing');
  }

  const { success, projectId, error } = await response.json();
  if (!success) {
    throw new Error(error || 'Failed to start processing');
  }

  // Poll for progress
  return new Promise((resolve, reject) => {
    const pollProgress = async () => {
      try {
        const progressResponse = await fetch(`/api/progress/${projectId}`);
        const progressData: ProcessingJob = await progressResponse.json();

        // Update progress (20-100% for processing phase)
        if (onProgress && progressData.progress !== undefined) {
          onProgress(0.2 + (progressData.progress / 100) * 0.8);
        }

        if (progressData.status === 'completed' && progressData.outputUrl) {
          resolve(progressData.outputUrl);
        } else if (progressData.status === 'error') {
          reject(new Error(progressData.error || 'Processing failed'));
        } else {
          // Continue polling
          setTimeout(pollProgress, 1000);
        }
      } catch (error) {
        reject(error);
      }
    };

    pollProgress();
  });
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
    throw new Error('Failed to generate thumbnail');
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