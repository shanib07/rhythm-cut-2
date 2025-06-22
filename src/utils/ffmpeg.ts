// Types
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

interface ProgressCallback {
  (progress: number): void;
}

// Mock video processing delay (ms)
const PROCESSING_DELAY = 500;
const MOCK_METADATA: VideoMetadata = {
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 30
};

/**
 * Simulates progress updates over time
 */
async function simulateProgress(
  durationMs: number,
  onProgress?: ProgressCallback
): Promise<void> {
  const steps = 10;
  const stepDelay = durationMs / steps;
  
  for (let i = 0; i < steps; i++) {
    await new Promise(resolve => setTimeout(resolve, stepDelay));
    onProgress?.((i + 1) / steps);
  }
}

/**
 * Mock function to get video metadata
 */
export const getVideoMetadata = async (videoFile: File): Promise<VideoMetadata> => {
  await new Promise(resolve => setTimeout(resolve, PROCESSING_DELAY));
  
  // Create a video element to get actual duration
  const videoEl = document.createElement('video');
  videoEl.src = URL.createObjectURL(videoFile);
  
  const metadata = await new Promise<VideoMetadata>((resolve) => {
    videoEl.onloadedmetadata = () => {
      resolve({
        ...MOCK_METADATA,
        duration: videoEl.duration
      });
    };
  });
  
  URL.revokeObjectURL(videoEl.src);
  return metadata;
};

/**
 * Mock function to trim video
 */
export const trimVideo = async (
  videoFile: File,
  startTime: number,
  endTime: number,
  onProgress?: ProgressCallback
): Promise<Blob> => {
  // Simulate processing time based on video duration
  const processingTime = (endTime - startTime) * 100;
  await simulateProgress(processingTime, onProgress);
  
  // For mock implementation, just return the original file
  return videoFile;
};

/**
 * Mock function to concatenate videos
 */
export const concatenateVideos = async (
  videoFiles: File[],
  onProgress?: ProgressCallback
): Promise<Blob> => {
  // Simulate processing time based on number of files
  const processingTime = videoFiles.length * 2000;
  await simulateProgress(processingTime, onProgress);
  
  // For mock implementation, return the first file
  return videoFiles[0];
};

/**
 * Mock function to process large video
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
): Promise<Blob> => {
  // Simulate processing time based on file size
  const processingTime = Math.min(videoFile.size / 1000000 * 500, 5000);
  await simulateProgress(processingTime, onProgress);
  
  // For mock implementation, return the original file
  return videoFile;
};

/**
 * Mock function to process video with options
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
): Promise<Blob> {
  // Simulate processing time based on options
  const processingTime = 3000 + (options.duration || 0) * 50;
  await simulateProgress(processingTime, options.onProgress);
  
  // For mock implementation, return the original file
  return inputFile;
}

/**
 * Mock function to generate thumbnail
 */
export async function generateThumbnail(
  inputFile: File,
  timeInSeconds: number
): Promise<Blob> {
  await new Promise(resolve => setTimeout(resolve, PROCESSING_DELAY));
  
  // For mock implementation, return the original file
  // In a real implementation, this would return a JPEG/PNG blob
  return inputFile;
}

// Mock cleanup function (no-op in mock version)
export async function cleanupFFmpeg(): Promise<void> {
  // Nothing to clean up in mock version
}

// Mock memory management functions
export function getMemoryInfo(): { total: number; free: number } {
  return {
    total: 1024 * 1024 * 1024, // 1GB
    free: 512 * 1024 * 1024    // 512MB
  };
}

export function hasEnoughMemory(): boolean {
  return true; // Always return true in mock version
}

export async function tryFreeMemory(): Promise<void> {
  // No-op in mock version
} 