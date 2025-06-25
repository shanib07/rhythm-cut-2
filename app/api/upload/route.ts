import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  console.log('📤 /api/upload - Request received');
  
  try {
    const formData = await request.formData();
    console.log('📋 FormData parsed successfully');
    
    const file = formData.get('file') as File;
    console.log('📁 File extracted from FormData:', file ? `${file.name} (${file.size} bytes)` : 'No file');
    
    if (!file) {
      console.log('❌ No file provided in request');
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log(`📊 File details: ${file.name}, ${(file.size / 1024 / 1024).toFixed(2)}MB, type: ${file.type}`);

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    console.log('📂 Creating uploads directory:', uploadsDir);
    await mkdir(uploadsDir, { recursive: true });
    console.log('✅ Uploads directory ready');

    // Generate unique filename
    const uniqueId = uuidv4();
    const extension = path.extname(file.name);
    const filename = `${uniqueId}${extension}`;
    const filepath = path.join(uploadsDir, filename);
    console.log(`💾 Generated filename: ${filename}, full path: ${filepath}`);

    // Save file to disk
    console.log('💾 Converting file to buffer...');
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    console.log(`💾 Buffer created: ${buffer.length} bytes`);
    
    console.log('💾 Writing file to disk...');
    await writeFile(filepath, buffer);
    console.log('✅ File written successfully');

    // Return the URL that can be accessed by the server
    const fileUrl = `/uploads/${filename}`;
    console.log('🌐 Generated file URL:', fileUrl);
    
    const responseData = {
      success: true,
      url: fileUrl,
      filename: filename,
      size: file.size
    };
    
    console.log('✅ Upload completed successfully, returning response:', responseData);
    return NextResponse.json(responseData);

  } catch (error) {
    console.error('💥 Upload failed with error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    
    return NextResponse.json(
      { error: 'Upload failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
}; 