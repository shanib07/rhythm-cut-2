import { NextRequest, NextResponse } from 'next/server';
import Queue from 'bull';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

interface VideoInput {
  id: string;
  url: string;
  duration: number;
}

const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  console.log('📡 API: Processing request received', { 
    timestamp: new Date().toISOString(),
    endpoint: '/api/process'
  });

  try {
    const body = await req.json();
    console.log('📡 API: Request body parsed', { 
      hasName: !!body.name,
      inputVideosCount: body.inputVideos?.length || 0,
      beatMarkersCount: body.beatMarkers?.length || 0,
      bodySize: JSON.stringify(body).length 
    });
    
    const { name, inputVideos, beatMarkers } = body;

    // Validate input
    if (!name || !inputVideos || !beatMarkers || 
        !Array.isArray(inputVideos) || !Array.isArray(beatMarkers)) {
      console.error('📡 API: Invalid input data validation failed', { 
        name: !!name, 
        inputVideos: !!inputVideos && Array.isArray(inputVideos), 
        beatMarkers: !!beatMarkers && Array.isArray(beatMarkers) 
      });
      return NextResponse.json(
        { error: 'Invalid input data. Missing name, inputVideos, or beatMarkers.' }, 
        { status: 400 }
      );
    }

    // Validate video input structure
    const validVideos = inputVideos.every((video: any) => 
      typeof video.id === 'string' &&
      typeof video.url === 'string' &&
      typeof video.duration === 'number'
    );

    if (!validVideos) {
      console.error('📡 API: Invalid video input format', { 
        sampleVideo: inputVideos[0] || 'none',
        allVideosValid: validVideos 
      });
      return NextResponse.json(
        { error: 'Invalid video input format' },
        { status: 400 }
      );
    }

    console.log('📡 API: Input validation passed', {
      videosCount: inputVideos.length,
      beatMarkersCount: beatMarkers.length,
      projectName: name
    });

    // Test Redis connection before proceeding
    console.log('📡 API: Testing Redis connection...');
    try {
      // Try to get queue stats to verify Redis is working
      const queueStats = await videoQueue.getWaiting();
      console.log('📡 API: Redis connection OK', { 
        queueLength: queueStats.length,
        queueName: videoQueue.name 
      });
    } catch (redisError) {
      console.error('📡 API: Redis connection failed', { 
        error: redisError instanceof Error ? redisError.message : 'Unknown Redis error',
        redisUrl: process.env.REDIS_URL ? 'Set' : 'Not set'
      });
      throw new Error(`Redis connection failed: ${redisError instanceof Error ? redisError.message : 'Unknown Redis error'}`);
    }

    // Create a default user for now (remove when auth is properly implemented)
    console.log('📡 API: Creating/finding user...');
    const defaultEmail = 'anonymous@rhythmcut.com';
    const user = await prisma.user.upsert({
      where: { email: defaultEmail },
      update: {},
      create: {
        email: defaultEmail,
        name: 'Anonymous User'
      }
    });

    console.log('📡 API: User found/created', { userId: user.id });

    // Create new project
    console.log('📡 API: Creating project in database...');
    const project = await prisma.project.create({
      data: {
        name,
        userId: user.id,
        inputVideos: JSON.parse(JSON.stringify(inputVideos)),
        beatMarkers,
        status: 'pending'
      }
    });

    console.log('📡 API: Project created successfully', { 
      projectId: project.id,
      status: project.status 
    });

    // Add job to queue with detailed logging
    console.log('📡 API: Adding job to queue...');
    try {
      const job = await videoQueue.add('process-video', {
        projectId: project.id
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 10,
        removeOnFail: 5,
      });
      
      console.log('📡 API: Job added to queue successfully', { 
        jobId: job.id,
        projectId: project.id,
        jobOptions: job.opts
      });

      // Verify job was actually added
      const jobCheck = await videoQueue.getJob(job.id);
      console.log('📡 API: Job verification', {
        jobExists: !!jobCheck,
        jobData: jobCheck?.data,
        jobStatus: await jobCheck?.getState()
      });

    } catch (queueError) {
      console.error('📡 API: Failed to add job to queue', { 
        error: queueError instanceof Error ? queueError.message : 'Unknown queue error',
        queueState: await videoQueue.getWaiting().then(jobs => ({ waitingJobs: jobs.length })).catch(() => ({ error: 'Cannot get queue state' }))
      });
      const errorMessage = queueError instanceof Error ? queueError.message : 'Unknown queue error';
      throw new Error(`Queue error: ${errorMessage}`);
    }

    const processingTime = Date.now() - startTime;
    console.log('📡 API: Request completed successfully', {
      projectId: project.id,
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      projectId: project.id,
      message: 'Video processing started'
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('📡 API: Processing request failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString()
    });
    
    // Return more detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = {
      error: 'Internal server error',
      details: errorMessage,
      timestamp: new Date().toISOString()
    };
    
    return NextResponse.json(errorDetails, { status: 500 });
  }
} 