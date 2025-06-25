import { NextRequest, NextResponse } from 'next/server';
import Queue from 'bull';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const startTime = Date.now();
  const params = await context.params;
  
  console.log('🔍 JOB-STATUS: Request received', {
    jobId: params.jobId,
    timestamp: new Date().toISOString()
  });

  try {
    const { jobId } = params;

    if (!jobId) {
      console.error('🔍 JOB-STATUS: No job ID provided');
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    // Get job from queue
    console.log('🔍 JOB-STATUS: Fetching job from queue', { jobId });
    const job = await videoQueue.getJob(jobId);

    if (!job) {
      console.error('🔍 JOB-STATUS: Job not found', { jobId });
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get job state and progress
    const state = await job.getState();
    const progress = job.progress();

    console.log('🔍 JOB-STATUS: Job details retrieved', {
      jobId,
      state,
      progress,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts
    });

    // Get additional job information
    const jobData = {
      id: job.id,
      state,
      progress,
      data: job.data,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      logs: [], // Logs not available in this Bull version
      returnvalue: job.returnvalue
    };

    const processingTime = Date.now() - startTime;
    console.log('🔍 JOB-STATUS: Response ready', {
      jobId,
      state,
      processingTimeMs: processingTime
    });

    return NextResponse.json({
      success: true,
      job: jobData
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('🔍 JOB-STATUS: Error getting job status', {
      jobId: params.jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json(
      { 
        error: 'Failed to get job status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 