import { NextApiRequest, NextApiResponse } from 'next';

interface VideoInput {
  url: string;
  fileName: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { inputVideos, beatMarkers, projectId, quality = 'balanced' }: {
      inputVideos: VideoInput[];
      beatMarkers: number[];
      projectId: string;
      quality?: 'fast' | 'balanced' | 'high';
    } = req.body;

    if (!inputVideos || !beatMarkers || !projectId) {
      return res.status(400).json({
        error: 'Missing required parameters: inputVideos, beatMarkers, projectId'
      });
    }

    console.log('🎬 Sending processing request to Google Cloud Run');
    console.log('📊 Request data:', {
      inputVideosCount: inputVideos?.length || 0,
      beatMarkersCount: beatMarkers?.length || 0,
      projectId,
      quality,
      inputVideosPreview: inputVideos?.slice(0, 2) || []
    });
    
    const cloudRunUrl = process.env.GOOGLE_CLOUD_RUN_URL || 
      'https://rhythm-cut-processor-859380352423.us-central1.run.app';
    
    console.log('🌐 Sending request to:', `${cloudRunUrl}/process`);
    
    const requestBody = {
      inputVideos,
      beatMarkers,
      projectId,
      quality
    };
    
    // Try to authenticate if we have Google credentials
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Check if Cloud Run requires authentication
    try {
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth();
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log('🔐 Added authentication token for Cloud Run');
      }
    } catch (authError) {
      console.log('⚠️ No authentication token available, trying without auth');
    }
    
    const response = await fetch(`${cloudRunUrl}/process`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(300000), // 5 minute timeout
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloud Run processing failed: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ Cloud Run processing completed', result);
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Cloud processing error:', error);
    res.status(500).json({
      error: 'Processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}