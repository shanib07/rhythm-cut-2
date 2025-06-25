import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  try {
    const { projectId } = await params;
    
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
    
    // Get project to verify ownership and get progress
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
    
    // Return progress information
    return NextResponse.json({
      status: project.status,
      progress: project.progress || 0,
      message: getStatusMessage(project.status, project.progress || 0),
      outputUrl: project.outputUrl
    });
    
  } catch (error) {
    console.error('Progress check failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getStatusMessage(status: string, progress: number): string {
  switch (status) {
    case 'pending':
      return 'Preparing export...';
    case 'uploading':
      return `Uploading videos... ${progress}%`;
    case 'processing':
      if (progress < 25) return 'Processing video segments...';
      if (progress < 75) return 'Combining segments...';
      if (progress < 95) return 'Finalizing video...';
      return 'Almost done...';
    case 'completed':
      return 'Export completed!';
    case 'error':
      return 'Export failed. Please try again.';
    default:
      return 'Processing...';
  }
} 