import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import Queue from 'bull';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

const previewQueue = new Queue('video-preview', process.env.REDIS_URL);

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, inputVideos, beatMarkers } = await req.json();

    // Validate input
    if (!inputVideos || !beatMarkers || 
        !Array.isArray(inputVideos) || !Array.isArray(beatMarkers)) {
      return NextResponse.json(
        { error: 'Invalid input data' }, 
        { status: 400 }
      );
    }

    // Create preview job
    const previewJob = await previewQueue.add('create-preview', {
      inputVideos,
      beatMarkers,
      quality: 'low', // Lower quality for faster preview
      resolution: '720p'
    });

    // Return job ID for status tracking
    return NextResponse.json({
      success: true,
      jobId: previewJob.id,
      message: 'Preview generation started'
    });

  } catch (error) {
    console.error('Preview generation failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 