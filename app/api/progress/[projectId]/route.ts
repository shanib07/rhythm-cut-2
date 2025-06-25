import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  console.log('🔄 /api/progress - Request received');
  
  try {
    const { projectId } = await params;
    console.log('🔍 Project ID extracted:', projectId);
    
    if (!projectId) {
      console.log('❌ No project ID provided');
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }
    
    console.log('🔍 Searching for project in database...');
    // Get project without authentication check (for now)
    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      }
    });
    
    if (!project) {
      console.log('❌ Project not found in database');
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    console.log('✅ Project found:', {
      id: project.id,
      status: project.status,
      progress: project.progress,
      name: project.name
    });
    
    // Return progress information
    const responseData = {
      status: project.status,
      progress: project.progress || 0,
      message: getStatusMessage(project.status, project.progress || 0),
      outputUrl: project.outputUrl,
      error: project.status === 'error' ? 'Processing failed' : undefined
    };
    
    console.log('📊 Returning progress data:', responseData);
    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('💥 Progress check failed:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
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