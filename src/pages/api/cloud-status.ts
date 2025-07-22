import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Cloud status check - environment variables:');
    console.log('  GOOGLE_CLOUD_CREDENTIALS exists:', !!process.env.GOOGLE_CLOUD_CREDENTIALS);
    console.log('  GOOGLE_APPLICATION_CREDENTIALS exists:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log('  NODE_ENV:', process.env.NODE_ENV);
    console.log('  All GOOGLE env vars:', Object.keys(process.env).filter(key => key.includes('GOOGLE')));
    
    const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    let credentialsValid = false;
    let credentialsError = null;
    
    if (credentialsJson) {
      try {
        const parsed = JSON.parse(credentialsJson);
        credentialsValid = true;
        console.log('✅ Credentials are valid JSON with project_id:', parsed.project_id);
      } catch (err) {
        credentialsError = err instanceof Error ? err.message : 'JSON parse error';
        console.log('❌ Credentials JSON parse failed:', credentialsError);
        console.log('Raw credentials (first 50 chars):', credentialsJson.substring(0, 50));
      }
    }
    
    const status = {
      googleCloudCredentials: !!credentialsJson,
      credentialsValid,
      credentialsError,
      googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID || null,
      inputBucket: process.env.GOOGLE_CLOUD_INPUT_BUCKET || null,
      outputBucket: process.env.GOOGLE_CLOUD_OUTPUT_BUCKET || null,
      cloudRunUrl: process.env.GOOGLE_CLOUD_RUN_URL || null,
      nodeEnv: process.env.NODE_ENV,
      allGoogleEnvVars: Object.keys(process.env).filter(key => key.includes('GOOGLE')),
      timestamp: new Date().toISOString()
    };

    // Test if Cloud Run service is accessible
    let cloudRunHealthy = false;
    if (process.env.GOOGLE_CLOUD_RUN_URL) {
      try {
        // Use AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const healthResponse = await fetch(process.env.GOOGLE_CLOUD_RUN_URL, {
          method: 'GET',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
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