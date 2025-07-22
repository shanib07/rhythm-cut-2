import { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';

// Disable default body parser
export const config = {
  api: {
    bodyParser: false,
  },
};

// Initialize Google Cloud Storage (dynamic import for server-only)
async function getStorageClient() {
  const { Storage } = await import('@google-cloud/storage');
  
  const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsJson) {
    throw new Error('GOOGLE_CLOUD_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS environment variable not set');
  }

  let credentials;
  try {
    console.log('🔍 Attempting to parse credentials JSON...');
    credentials = JSON.parse(credentialsJson);
    console.log('✅ Successfully parsed credentials, project_id:', credentials.project_id);
  } catch (parseError) {
    console.error('❌ Failed to parse credentials JSON:', parseError);
    console.log('Raw credentials (first 100 chars):', credentialsJson.substring(0, 100));
    throw new Error('Invalid Google Cloud credentials format - not valid JSON');
  }
  
  return new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials.project_id || 'rhythm-cut-466519',
    credentials
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📤 Cloud upload request received - v3');
    
    // Debug environment variables
    console.log('🔍 Environment variable debug:');
    console.log('  GOOGLE_CLOUD_CREDENTIALS exists:', !!process.env.GOOGLE_CLOUD_CREDENTIALS);
    console.log('  GOOGLE_APPLICATION_CREDENTIALS exists:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log('  NODE_ENV:', process.env.NODE_ENV);
    
    // Check for required environment variables first
    const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsJson) {
      console.error('❌ No Google Cloud credentials found in environment');
      console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('GOOGLE')));
      return res.status(500).json({ 
        error: 'Google Cloud not configured', 
        message: 'No Google Cloud credentials environment variable found' 
      });
    }
    
    console.log('✅ Found credentials, length:', credentialsJson.length);
    console.log('✅ Credentials start:', credentialsJson.substring(0, 50) + '...');
    
    // Parse multipart form data with increased limits
    console.log('🔍 Parsing multipart form data...');
    const form = formidable({ 
      multiples: true,
      maxFileSize: 500 * 1024 * 1024, // 500MB per file
      maxTotalFileSize: 2000 * 1024 * 1024, // 2GB total
      maxFieldsSize: 2000 * 1024 * 1024, // 2GB total fields
    });
    const [, files] = await form.parse(req);
    
    console.log('📦 Files received:', Object.keys(files));
    
    const storage = await getStorageClient();
    const bucket = storage.bucket(process.env.GOOGLE_CLOUD_INPUT_BUCKET || 'rhythm-cut-inputs-466519');
    
    // Handle multiple files
    const fileArray = Array.isArray(files.videos) ? files.videos : [files.videos].filter(Boolean);
    
    const uploadedVideos = await Promise.all(
      fileArray.map(async (file: any, index: number) => {
        const fileName = `${Date.now()}-${index}-${file.originalFilename}`;
        const cloudPath = `uploads/${fileName}`;
        
        console.log(`🚀 Starting upload ${index + 1}/${fileArray.length}: ${file.originalFilename} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        
        // Upload to Cloud Storage with progress
        await bucket.upload(file.filepath, {
          destination: cloudPath,
          metadata: {
            contentType: file.mimetype,
          },
          resumable: file.size > 10 * 1024 * 1024, // Use resumable upload for files > 10MB
        });
        
        // Clean up temp file
        fs.unlinkSync(file.filepath);
        
        console.log(`✅ Uploaded ${file.originalFilename} to ${cloudPath}`);
        
        return {
          url: cloudPath,
          fileName: file.originalFilename
        };
      })
    );
    
    res.json({ 
      success: true, 
      videos: uploadedVideos 
    });
    
  } catch (error) {
    console.error('❌ Cloud upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}