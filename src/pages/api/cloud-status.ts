import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const status = {
      googleCloudCredentials: !!process.env.GOOGLE_CLOUD_CREDENTIALS,
      googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID || null,
      inputBucket: process.env.GOOGLE_CLOUD_INPUT_BUCKET || null,
      outputBucket: process.env.GOOGLE_CLOUD_OUTPUT_BUCKET || null,
      cloudRunUrl: process.env.GOOGLE_CLOUD_RUN_URL || null,
      timestamp: new Date().toISOString()
    };

    // Test if Cloud Run service is accessible
    let cloudRunHealthy = false;
    if (process.env.GOOGLE_CLOUD_RUN_URL) {
      try {
        const healthResponse = await fetch(process.env.GOOGLE_CLOUD_RUN_URL, {
          method: 'GET',
          timeout: 5000
        });
        cloudRunHealthy = healthResponse.ok;
      } catch (error) {
        console.log('Cloud Run health check failed:', error);
        cloudRunHealthy = false;
      }
    }

    res.json({
      configured: status.googleCloudCredentials && status.googleCloudProjectId,
      cloudRunHealthy,
      details: status
    });

  } catch (error) {
    console.error('Cloud status check error:', error);
    res.status(500).json({ 
      error: 'Status check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}