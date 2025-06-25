import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const timeString = formData.get('time') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!timeString) {
      return NextResponse.json({ error: 'No time provided' }, { status: 400 });
    }

    const time = parseFloat(timeString);
    if (isNaN(time) || time < 0) {
      return NextResponse.json({ error: 'Invalid time value' }, { status: 400 });
    }

    // Create temporary directory
    const tempDir = path.join(process.cwd(), 'tmp');
    const inputPath = path.join(tempDir, `input-${Date.now()}-${Math.random().toString(36).substring(7)}.${file.name.split('.').pop()}`);
    const outputPath = path.join(tempDir, `thumbnail-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`);

    try {
      // Ensure temp directory exists
      await import('fs').then(fs => 
        fs.promises.mkdir(tempDir, { recursive: true })
      );

      // Save uploaded file
      const bytes = await file.arrayBuffer();
      await writeFile(inputPath, Buffer.from(bytes));

      // Generate thumbnail using FFmpeg
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(time)
          .frames(1)
          .size('320x240')
          .format('image2')
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .run();
      });

      // Read the generated thumbnail
      const thumbnailBuffer = await import('fs').then(fs => 
        fs.promises.readFile(outputPath)
      );

      // Clean up temporary files
      await Promise.all([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {})
      ]);

      // Return the thumbnail
      return new NextResponse(thumbnailBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': thumbnailBuffer.length.toString(),
        },
      });

    } catch (processingError) {
      // Clean up files in case of error
      await Promise.all([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {})
      ]);
      throw processingError;
    }

  } catch (error) {
    console.error('Thumbnail generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate thumbnail' },
      { status: 500 }
    );
  }
} 