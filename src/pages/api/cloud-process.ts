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
    
    const cloudRunUrl = process.env.GOOGLE_CLOUD_RUN_URL || 
      'https://rhythm-cut-processor-859380352423.us-central1.run.app';
    
    const response = await fetch(`${cloudRunUrl}/process`, {
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