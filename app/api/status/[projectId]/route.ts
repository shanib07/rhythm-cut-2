import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RouteParams {
  params: {
    projectId: string;
  };
  searchParams: { [key: string]: string | string[] | undefined };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { projectId } = params;

    // Get project status
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        status: true,
        outputUrl: true
      }
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({
      status: project.status,
      outputUrl: project.outputUrl
    });

  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 