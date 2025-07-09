import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

export async function GET(
  request: Request
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
    
    // First, check if this is a direct export (file exists in exports directory)
    const exportPath = path.join(process.cwd(), 'public', 'exports', `${projectId}.mp4`);
    try {
      await fs.access(exportPath);
      // File exists, return it directly (no auth required for direct exports)
      const fileData = await fs.readFile(exportPath);
      
      console.log('Direct export file found and serving:', exportPath);
      
      // Optional: Clean up the file after sending
      setTimeout(() => {
        fs.unlink(exportPath).catch(err => 
          console.log('Failed to cleanup export file:', err.message)
        );
      }, 10000); // Clean up after 10 seconds
      
      return new Response(fileData, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="rhythm-cut-${projectId}.mp4"`,
          'Content-Length': fileData.length.toString(),
          'Cache-Control': 'no-cache',
        },
      });
    } catch (error) {
      // File doesn't exist in exports, continue with database check
      console.log('Export file not found, checking database...', error);
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

    // Try multiple potential file locations
    const possiblePaths = [
      path.join(process.cwd(), 'tmp', 'exports', `${projectId}.mp4`),
      path.join('/tmp', 'exports', `${projectId}.mp4`),
      path.join(process.cwd(), 'public', 'exports', `${projectId}.mp4`),
    ];
    
    let fileData: Buffer | null = null;
    let filePath: string | null = null;

    // Try to find the file in different locations
    for (const tryPath of possiblePaths) {
      try {
        await fs.access(tryPath);
        fileData = await fs.readFile(tryPath);
        filePath = tryPath;
        break;
      } catch (error) {
        console.log(`File not found at: ${tryPath}`);
        continue;
      }
    }

    if (!fileData) {
      console.error('Video file not found in any location');
      return NextResponse.json(
        { error: 'Video file not found. It may have been cleaned up due to Railway\'s ephemeral storage.' },
        { status: 404 }
      );
    }
    
    // Clean up the file after sending (optional, since Railway cleans up anyway)
    if (filePath) {
      fs.unlink(filePath).catch(err => 
        console.log('Failed to cleanup file:', err.message)
      );
    }
    
    return new Response(fileData, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${project.name || 'rhythm-cut-video'}.mp4"`,
        'Content-Length': fileData.length.toString(),
        'Cache-Control': 'no-cache',
      },
    });
    
  } catch (error) {
    console.error('Download failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 