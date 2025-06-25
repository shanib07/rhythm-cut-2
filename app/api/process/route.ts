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
  try {
    console.log('Processing request received');
    
    const body = await req.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    const { name, inputVideos, beatMarkers } = body;

    // Validate input
    if (!name || !inputVideos || !beatMarkers || 
        !Array.isArray(inputVideos) || !Array.isArray(beatMarkers)) {
      console.error('Invalid input data:', { name, inputVideos: !!inputVideos, beatMarkers: !!beatMarkers });
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
      console.error('Invalid video input format:', inputVideos);
      return NextResponse.json(
        { error: 'Invalid video input format' },
        { status: 400 }
      );
    }

    console.log(`Processing ${inputVideos.length} videos with ${beatMarkers.length} beat markers`);

    // Create a default user for now (remove when auth is properly implemented)
    const defaultEmail = 'anonymous@rhythmcut.com';
    const user = await prisma.user.upsert({
      where: { email: defaultEmail },
      update: {},
      create: {
        email: defaultEmail,
        name: 'Anonymous User'
      }
    });

    console.log('User found/created:', user.id);

    // Create new project
    const project = await prisma.project.create({
      data: {
        name,
        userId: user.id,
        inputVideos: JSON.parse(JSON.stringify(inputVideos)),
        beatMarkers,
        status: 'pending'
      }
    });

    console.log('Project created:', project.id);

    // Add job to queue with detailed logging
    try {
      const job = await videoQueue.add('process-video', {
        projectId: project.id
      });
      console.log('Job added to queue:', job.id);
    } catch (queueError) {
      console.error('Failed to add job to queue:', queueError);
      const errorMessage = queueError instanceof Error ? queueError.message : 'Unknown queue error';
      throw new Error(`Queue error: ${errorMessage}`);
    }

    return NextResponse.json({
      success: true,
      projectId: project.id,
      message: 'Video processing started'
    });

  } catch (error) {
    console.error('Processing request failed:', error);
    
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