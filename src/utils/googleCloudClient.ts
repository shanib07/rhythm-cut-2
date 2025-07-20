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
  console.log('📤 Uploading videos to Google Cloud Storage via Railway API');
  
  const formData = new FormData();
  videos.forEach((video, index) => {
    formData.append('videos', video);
  });
  
  const response = await fetch('/api/cloud-upload', {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload failed: ${error}`);
  }
  
  const result = await response.json();
  console.log('✅ Videos uploaded to Cloud Storage');
  
  return result.videos;
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