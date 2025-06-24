import { NextRequest, NextResponse } from 'next/server';
import Queue from 'bull';
import path from 'path';
import fs from 'fs/promises';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

const previewQueue = new Queue('video-preview', process.env.REDIS_URL);

export async function GET(
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const segments = url.pathname.split('/');
    const jobId = segments[segments.length - 1];
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }
    
    const job = await previewQueue.getJob(jobId);
    
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }
    
    const state = await job.getState();
    
    if (state !== 'completed') {
      return NextResponse.json(
        { error: 'Job not completed' },
        { status: 400 }
      );
    }
    
    const result = job.returnvalue;
    
    if (result?.previewUrl) {
      // In production, this would be a cloud storage URL
      // For now, serve the file directly
      const filePath = result.previewUrl;
      
      try {
        const fileData = await fs.readFile(filePath);
        
        return new Response(fileData, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': fileData.length.toString(),
          },
        });
      } catch (error) {
        console.error('Error reading preview file:', error);
        return NextResponse.json(
          { error: 'Preview file not found' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Preview URL not available' },
      { status: 404 }
    );
    
  } catch (error) {
    console.error('Preview URL check failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 