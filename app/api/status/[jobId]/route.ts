import { NextResponse } from 'next/server';
import Queue from 'bull';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

const previewQueue = new Queue('video-preview', process.env.REDIS_URL);
const exportQueue = new Queue('video-processing', process.env.REDIS_URL);

export async function GET(
  req: Request
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/');
    const jobId = segments[segments.length - 1];
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }
    
    // Check preview queue first
    let job = await previewQueue.getJob(jobId);
    let queueType = 'preview';
    
    // If not found in preview queue, check export queue
    if (!job) {
      job = await exportQueue.getJob(jobId);
      queueType = 'export';
    }
    
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }
    
    const progress = job.progress();
    const state = await job.getState();
    
    let result = null;
    if (state === 'completed') {
      result = job.returnvalue;
    }
    
    return NextResponse.json({
      jobId,
      queueType,
      state,
      progress,
      result,
      createdAt: new Date(job.timestamp),
      processedOn: job.processedOn ? new Date(job.processedOn) : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn) : null
    });
    
  } catch (error) {
    console.error('Status check failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 