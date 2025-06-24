import { NextRequest, NextResponse } from 'next/server';
import Queue from 'bull';

// Initialize queues (same Redis URL as workers)
const previewQueue = new Queue('video-preview', process.env.REDIS_URL!);
const exportQueue = new Queue('video-processing', process.env.REDIS_URL!);

type RouteContext = {
  params: {
    jobId: string;
  };
};

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { jobId } = params;
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    // Try to find the job in both queues
    let job = await previewQueue.getJob(jobId);
    let queueType = 'preview';
    
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

    const state = await job.getState();
    const progress = job.progress();
    
    return NextResponse.json({
      jobId: job.id,
      state,
      progress,
      queueType,
      data: job.data,
      createdAt: job.timestamp,
      processedAt: job.processedOn,
      finishedAt: job.finishedOn,
      failedReason: job.failedReason
    });

  } catch (error) {
    console.error('Error getting job progress:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 