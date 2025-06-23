import { NextRequest, NextResponse } from 'next/server';
import Queue from 'bull';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

interface ProcessRequest {
  name: string;
  inputVideos: string[];
  beatMarkers: number[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ProcessRequest;
    const { name, inputVideos, beatMarkers } = body;

    // Validate input
    if (!name || !inputVideos || !beatMarkers || 
        !Array.isArray(inputVideos) || !Array.isArray(beatMarkers)) {
      return NextResponse.json(
        { error: 'Invalid input data' }, 
        { status: 400 }
      );
    }

    // Create new project
    const project = await prisma.project.create({
      data: {
        name,
        inputVideos,
        beatMarkers,
        status: 'pending'
      }
    });

    // Add job to queue
    await videoQueue.add('process-video', {
      projectId: project.id
    });

    return NextResponse.json({
      success: true,
      projectId: project.id,
      message: 'Video processing started'
    });

  } catch (error) {
    console.error('Processing request failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 