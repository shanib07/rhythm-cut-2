import { processVideo, generateThumbnail } from './ffmpeg';

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
 */
export async function loadVideoProgressively(
  file: File,
  onProgress?: (progress: number) => void
): Promise<VideoChunk[]> {
  const chunks: VideoChunk[] = [];
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    
    const chunk = file.slice(start, end);
    const buffer = await chunk.arrayBuffer();
    
    chunks.push({
      start,
      end,
      data: new Uint8Array(buffer)
    });
    
    onProgress?.((i + 1) / totalChunks);
  }
  
  return chunks;
}

/**
 * Generate optimized thumbnails for video preview
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
    
    // Generate thumbnails in parallel with resource limits
    const batchSize = 2; // Process 2 thumbnails at a time
    for (let i = 0; i < times.length; i += batchSize) {
      const batch = times.slice(i, i + batchSize);
      const batchPromises = batch.map(async (time) => {
        const blob = await generateThumbnail(file, time);
        return {
          time,
          url: URL.createObjectURL(blob)
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      thumbnails.push(...batchResults);
    }
    
    return thumbnails.sort((a, b) => a.time - b.time);
  } catch (error) {
    // Clean up any created URLs on error
    thumbnails.forEach(t => URL.revokeObjectURL(t.url));
    throw error;
  }
}

/**
 * Process video chunks with optimized settings
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
): Promise<Blob> {
  // Combine chunks into a single file
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
  const combinedData = new Uint8Array(totalSize);
  
  let offset = 0;
  for (const chunk of chunks) {
    combinedData.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  
  const file = new File([combinedData], 'input.mp4', { type: 'video/mp4' });
  
  try {
    return await processVideo(file, {
      startTime: options.startTime,
      duration: options.endTime !== undefined
        ? options.endTime - (options.startTime || 0)
        : undefined,
      width: options.width,
      height: options.height,
      onProgress
    });
  } finally {
    // Clean up the temporary file
    URL.revokeObjectURL(URL.createObjectURL(file));
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
 * Check if video format is supported
 */
export function isVideoSupported(file: File): boolean {
  const supportedFormats = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo'
  ];
  
  return supportedFormats.includes(file.type);
} 