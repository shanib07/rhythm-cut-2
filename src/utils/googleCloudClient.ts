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

export async function uploadVideosToCloudStorage(videos: File[]): Promise<VideoInput[]> {
  console.log('📤 Uploading videos to Google Cloud Storage via Railway API', {
    videoCount: videos.length,
    totalSize: videos.reduce((sum, v) => sum + v.size, 0)
  });
  
  const formData = new FormData();
  videos.forEach((video, index) => {
    formData.append('videos', video);
    console.log(`📦 Added video ${index + 1}: ${video.name} (${Math.round(video.size / 1024 / 1024)}MB)`);
  });
  
  try {
    const response = await fetch('/api/cloud-upload', {
      method: 'POST',
      body: formData,
    });
    
    console.log('🌐 Upload response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Upload failed with status:', response.status);
      console.error('❌ Upload error details:', error);
      throw new Error(`Upload failed (${response.status}): ${error}`);
    }
    
    const result = await response.json();
    console.log('✅ Videos uploaded to Cloud Storage successfully', result);
    
    return result.videos;
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