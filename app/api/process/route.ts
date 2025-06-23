import { NextRequest, NextResponse } from 'next/server';
import Queue from 'bull';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';

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
    // Get authenticated user
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, inputVideos, beatMarkers } = body;

    // Validate input
    if (!name || !inputVideos || !beatMarkers || 
        !Array.isArray(inputVideos) || !Array.isArray(beatMarkers)) {
      return NextResponse.json(
        { error: 'Invalid input data' }, 
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
      return NextResponse.json(
        { error: 'Invalid video input format' },
        { status: 400 }
      );
    }

    // Get or create user
    const user = await prisma.user.upsert({
      where: { email: session.user.email },
      update: {},
      create: {
        email: session.user.email,
        name: session.user.name || 'Anonymous'
      }
    });

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