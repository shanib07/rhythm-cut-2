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
  
  const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credentialsJson) {
    throw new Error('GOOGLE_CLOUD_CREDENTIALS environment variable not set');
  }

  const credentials = JSON.parse(credentialsJson);
  return new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || 'rhythm-cut-466519',
    credentials
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📤 Cloud upload request received');
    
    // Parse multipart form data
    const form = formidable({ multiples: true });
    const [fields, files] = await form.parse(req);
    
    const storage = await getStorageClient();
    const bucket = storage.bucket(process.env.GOOGLE_CLOUD_INPUT_BUCKET || 'rhythm-cut-inputs-466519');
    
    // Handle multiple files
    const fileArray = Array.isArray(files.videos) ? files.videos : [files.videos].filter(Boolean);
    
    const uploadedVideos = await Promise.all(
      fileArray.map(async (file: any, index: number) => {
        const fileName = `${Date.now()}-${index}-${file.originalFilename}`;
        const cloudPath = `uploads/${fileName}`;
        
        // Upload to Cloud Storage
        await bucket.upload(file.filepath, {
          destination: cloudPath,
          metadata: {
            contentType: file.mimetype,
          },
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