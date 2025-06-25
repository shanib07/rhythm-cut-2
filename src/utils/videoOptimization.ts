import { uploadVideoFile, getVideoMetadata, processVideoWithBeats } from './ffmpeg';

const CHUNK_SIZE = 1024 * 1024 * 10; // 10MB chunks
const THUMBNAIL_INTERVAL = 5; // Generate thumbnail every 5 seconds
const MAX_THUMBNAILS = 6; // Maximum number of thumbnails per video

interface VideoChunk {
  start: number;
  end: number;
  data: Uint8Array;
}

interface ThumbnailResult {
  time: number;
  url: string;
}

/**
 * Progressive video loader that handles large files in chunks
 * For server-side processing, we can handle larger files directly
 */
export async function loadVideoProgressively(
  file: File,
  onProgress?: (progress: number) => void
): Promise<VideoChunk[]> {
  // For server-side processing, we don't need to chunk files
  // This function is kept for compatibility but now just loads the entire file
  onProgress?.(0.5);
  
  const buffer = await file.arrayBuffer();
  const chunks: VideoChunk[] = [{
    start: 0,
    end: file.size,
    data: new Uint8Array(buffer)
  }];
  
  onProgress?.(1);
  return chunks;
}

/**
 * Generate optimized thumbnails using server-side processing
 */
export async function generateThumbnails(
  file: File,
  duration: number
): Promise<ThumbnailResult[]> {
  const thumbnails: ThumbnailResult[] = [];
  
  try {
    // Calculate optimal thumbnail times
    const interval = Math.max(duration / (MAX_THUMBNAILS - 1), THUMBNAIL_INTERVAL);
    const times = Array.from(
      { length: Math.min(MAX_THUMBNAILS, Math.ceil(duration / interval)) },
      (_, i) => i * interval
    );
    
    // Generate thumbnails using server API
    const batchSize = 2; // Process 2 thumbnails at a time
    for (let i = 0; i < times.length; i += batchSize) {
      const batch = times.slice(i, i + batchSize);
      const batchPromises = batch.map(async (time) => {
        try {
          // Use server-side thumbnail generation
          const formData = new FormData();
          formData.append('file', file);
          formData.append('time', time.toString());
          
          const response = await fetch('/api/thumbnail', {
            method: 'POST',
            body: formData
          });
          
          if (!response.ok) {
            throw new Error(`Failed to generate thumbnail at ${time}s`);
          }
          
          const blob = await response.blob();
          return {
            time,
            url: URL.createObjectURL(blob)
          };
        } catch (error) {
          console.warn(`Failed to generate thumbnail at ${time}s:`, error);
          // Return a placeholder or skip this thumbnail
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validThumbnails = batchResults.filter((result): result is ThumbnailResult => result !== null);
      thumbnails.push(...validThumbnails);
    }
    
    return thumbnails.sort((a, b) => a.time - b.time);
  } catch (error) {
    // Clean up any created URLs on error
    thumbnails.forEach(t => URL.revokeObjectURL(t.url));
    throw error;
  }
}

/**
 * Process video chunks using server-side processing
 */
export async function processVideoChunks(
  chunks: VideoChunk[],
  options: {
    startTime?: number;
    endTime?: number;
    width?: number;
    height?: number;
  },
  onProgress?: (progress: number) => void
): Promise<string> {
  // Combine chunks into a single file for server processing
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
  const combinedData = new Uint8Array(totalSize);
  
  let offset = 0;
  for (const chunk of chunks) {
    combinedData.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  
  const file = new File([combinedData], 'input.mp4', { type: 'video/mp4' });
  
  try {
    // Use server-side processing
    const videos = [{ file, id: 'chunked-video' }];
    const beatMarkers = [
      options.startTime || 0,
      options.endTime || (await getVideoMetadata(file)).duration
    ];
    
    return await processVideoWithBeats(
      videos,
      beatMarkers,
      'Chunked Video Processing',
      onProgress
    );
  } finally {
    // The server handles file cleanup
  }
}

/**
 * Retry mechanism for failed operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      if (attempt === maxAttempts) {
        throw new Error(`Failed after ${maxAttempts} attempts: ${lastError.message}`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  
  throw lastError;
}

/**
 * Cleanup all resources
 */
export function cleanupResources(urls: string[]) {
  urls.forEach(url => {
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn('Failed to revoke URL:', error);
    }
  });
}

/**
 * Check if video format is supported by server
 */
export function isVideoSupported(file: File): boolean {
  const supportedFormats = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/avi'
  ];
  
  return supportedFormats.includes(file.type);
}

/**
 * Upload multiple videos to server
 */
export async function uploadVideos(
  files: File[],
  onProgress?: (fileIndex: number, totalFiles: number) => void
): Promise<Array<{ id: string; url: string; duration: number }>> {
  const uploadedVideos = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length);
    
    const serverUrl = await uploadVideoFile(file);
    const metadata = await getVideoMetadata(file);
    
    uploadedVideos.push({
      id: `video-${i}`,
      url: serverUrl,
      duration: metadata.duration
    });
  }
  
  onProgress?.(files.length, files.length);
  return uploadedVideos;
} 