import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  { params }: { params: { projectId: string } }
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const segments = url.pathname.split('/');
    const projectId = segments[segments.length - 1];
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }
    
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get project to verify ownership
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user: {
          email: session.user.email
        }
      }
    });
    
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    if (project.status !== 'completed') {
      return NextResponse.json(
        { error: 'Project not completed' },
        { status: 400 }
      );
    }
    
    // Get the file path
    const filePath = path.join(process.cwd(), 'tmp', 'exports', `${projectId}.mp4`);
    
    try {
      const fileData = await fs.readFile(filePath);
      
      return new Response(fileData, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${project.name || 'video'}.mp4"`,
          'Content-Length': fileData.length.toString(),
        },
      });
    } catch (error) {
      console.error('Error reading video file:', error);
      return NextResponse.json(
        { error: 'Video file not found' },
        { status: 404 }
      );
    }
    
  } catch (error) {
    console.error('Download failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 