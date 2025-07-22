// Client-side Google Cloud integration
// All Google Cloud operations go through Railway API routes for security

export interface VideoInput {
  url: string;
  fileName: string;
}

export interface ProcessingResult {
  success: boolean;
  outputUrl?: string;
  error?: string;
  processingTimeMs?: number;
}

export async function uploadVideosToCloudStorage(
  videos: File[], 
  onProgress?: (progress: number, message: string) => void
): Promise<VideoInput[]> {
  const totalSize = videos.reduce((sum, v) => sum + v.size, 0);
  console.log('📤 Uploading videos to Google Cloud Storage via Railway API', {
    videoCount: videos.length,
    totalSize
  });
  
  onProgress?.(5, `Preparing ${videos.length} videos for upload (${Math.round(totalSize / 1024 / 1024)}MB)...`);
  
  const formData = new FormData();
  videos.forEach((video, index) => {
    formData.append('videos', video);
    console.log(`📦 Added video ${index + 1}: ${video.name} (${Math.round(video.size / 1024 / 1024)}MB)`);
  });
  
  onProgress?.(10, 'Starting upload to Google Cloud Storage...');
  
  try {
    // Use XMLHttpRequest to track upload progress
    const result = await new Promise<VideoInput[]>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 80; // Reserve 20% for processing
          const uploadedMB = Math.round(event.loaded / 1024 / 1024);
          const totalMB = Math.round(event.total / 1024 / 1024);
          onProgress?.(10 + percentComplete, `Uploading... ${uploadedMB}MB / ${totalMB}MB`);
        }
      });
      
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(90, 'Upload complete, processing response...');
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response.videos);
          } catch (e) {
            reject(new Error('Failed to parse response'));
          }
        } else {
          console.error('❌ Upload failed with status:', xhr.status);
          console.error('❌ Upload error details:', xhr.responseText);
          reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
        }
      });
      
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });
      
      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timed out'));
      });
      
      xhr.open('POST', '/api/cloud-upload');
      xhr.timeout = 300000; // 5 minute timeout
      xhr.send(formData);
    });
    
    console.log('✅ Videos uploaded to Cloud Storage successfully', result);
    onProgress?.(100, 'Upload complete!');
    
    return result;
  } catch (error) {
    console.error('❌ Upload request failed:', error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Network error: Unable to reach cloud upload service');
    }
    throw error;
  }
}

export async function processVideoOnCloudRun(
  inputVideos: VideoInput[],
  beatMarkers: number[],
  projectId: string,
  quality: 'fast' | 'balanced' | 'high' = 'balanced'
): Promise<ProcessingResult> {
  console.log('🎬 Sending processing request to Google Cloud Run via Railway API');
  
  try {
    const response = await fetch('/api/cloud-process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputVideos,
        beatMarkers,
        projectId,
        quality
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloud processing failed: ${error}`);
    }
    
    const result = await response.json();
    console.log('✅ Cloud Run processing completed', result);
    
    return {
      success: true,
      outputUrl: result.outputUrl,
      processingTimeMs: result.processingTimeMs
    };
  } catch (error) {
    console.error('❌ Cloud Run processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function downloadFromCloudStorage(signedUrl: string): Promise<Blob> {
  console.log('📥 Downloading processed video from Cloud Storage');
  
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  
  return response.blob();
}