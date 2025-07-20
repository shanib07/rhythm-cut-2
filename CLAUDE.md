# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rhythm Cut is an AI-powered video editor that automatically syncs video clips to music beats using beat detection and FFmpeg. Users can create beat-synchronized video edits through multiple interfaces with different levels of control.

**Frontend:**  
- Next.js 15 with React 19 and TypeScript
- Tailwind CSS for styling
- Framer Motion for animations
- Sonner for toast notifications

**Backend:**  
- Node.js with Express-style API routes
- Bull (Redis job queue) for video processing
- FFmpeg-based video processing with fluent-ffmpeg
- Socket.IO dependencies (but HTTP polling used for progress)
- Prisma ORM with PostgreSQL
- NextAuth v4 with Google OAuth

## Commands

### Development
```bash
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Build for production
npm run start        # Start production server (uses server/start.js)
npm run start:app    # Start Next.js app only
npm run start:worker # Start worker process only
npm run lint         # Run ESLint
```

### Database
```bash
npx prisma generate      # Generate Prisma client
npx prisma db push       # Push schema changes to database
npx prisma migrate dev   # Create and apply migrations
```

## Architecture

### Application Structure
- **`/` (Landing)**: Three-card navigation to different editing modes
- **`/easyedit`**: 3-step automated workflow (audio → video → process)
- **`/edit`**: Advanced editor with manual timeline control and beat tweaking
- **`/beat-test`**: Beat detection testing and algorithm comparison UI

### Video Processing Architecture
The app uses a multi-tier processing system:

1. **Direct Processing** (`/api/process-direct`): Synchronous processing for immediate results
2. **Queue Processing** (`/api/process`): Asynchronous with Bull queue for scalability
3. **Fast Processing** (`/api/process-fast`): Parallel batch processing

**Processing Flow:**
1. Video segmentation based on beat markers
2. Individual segment processing (libx264/aac encoding)
3. Concatenation using FFmpeg's concat demuxer
4. Audio track merging with precise sync

### Beat Detection System
- **Three algorithms**: Onset detection (recommended), Energy-based peaks, Valley-to-peak
- **Tone.js + Web Audio API**: Client-side beat analysis
- **AudioAnalyzer service**: Centralized beat detection with configurable sensitivity
- **WaveformVisualizer**: Real-time visual feedback

### File Upload & Storage
- **Upload endpoint**: `/api/upload` with multipart form handling
- **Storage locations**: 
  - Input files: `public/uploads/`
  - Processing temp: `tmp/`
  - Final outputs: `public/exports/`
- **UUID-based filenames** prevent collisions

### Database Schema
- **User model**: Authentication with Google OAuth
- **Project model**: Stores beat markers (Float[]), input videos (JSON), processing status
- **Progress tracking**: Real-time status updates via database polling

### State Management
- **Zustand**: Global video store for audio/video state
- **Local component state**: UI-specific states in React components
- **Progress polling**: HTTP-based progress updates (1-second intervals)

## Key Components

### Core Processing
- **`AudioAnalyzer`**: Beat detection algorithms and audio analysis
- **`VideoProcessor`**: Client-side video processing utilities
- **`FFmpeg utils`**: Server-side video processing with fluent-ffmpeg

### UI Components
- **`FilmstripEditor`**: Video timeline editing with thumbnail navigation
- **`WaveformVisualizer`**: Audio waveform display with beat markers
- **`BeatManager`**: Beat marker management and timeline control
- **`ProcessingModal`**: Export progress visualization

### API Routes
- **Processing**: `/api/process-direct`, `/api/process`, `/api/process-fast`
- **File management**: `/api/upload`, `/api/download/[projectId]`
- **Progress tracking**: `/api/progress/[projectId]`, `/api/job-status/[jobId]`
- **Authentication**: `/api/auth/[...nextauth]`

## Common Issues

### Export Problems
- Ensure FFmpeg is available in deployment environment
- Check file permissions for uploads/exports directories
- Verify toast messages are visible (configured with proper contrast)

### Beat Detection Issues
- Test different algorithms in `/beat-test` for optimal results
- Adjust sensitivity settings for different audio types
- Validate audio file formats before processing

### Performance Optimization
- Videos are processed in segments to manage memory usage
- Bull queue handles concurrent job processing
- File cleanup occurs after processing completion

## Environment Variables

```bash
DATABASE_URL          # PostgreSQL connection string
REDIS_URL            # Redis URL for Bull queue
NEXTAUTH_URL         # Authentication callback URL
NEXTAUTH_SECRET      # NextAuth session secret
GOOGLE_CLIENT_ID     # Google OAuth client ID
GOOGLE_CLIENT_SECRET # Google OAuth client secret
```

## Development Notes

### Video Processing Quality Settings
- **Fast**: 720p, CRF 30, ultrafast preset
- **Balanced**: 720p, CRF 21, fast preset  
- **High**: 1080p, CRF 18, slow preset

### Railway Deployment
- Uses Docker with multi-stage build
- Ephemeral filesystem requires S3 for production file storage
- Worker process runs separately from web server

### Testing Beat Detection
Use `/beat-test` page to compare algorithms:
- **Onset Detection**: Best for most music types
- **Energy-based**: Good for electronic/dance music
- **Valley-to-peak**: Alternative for complex rhythms

## Hybrid Export System

The application uses a sophisticated hybrid export system that attempts multiple processing methods in order of preference:

### Export Method Priority
1. **WebCodecs API**: Browser-based, ultra-fast (5-10x faster than FFmpeg)
2. **Canvas + MediaRecorder**: Client-side fallback with broader browser support  
3. **Server-side FFmpeg**: Most reliable, handles all video formats

### Export Quality Settings
The `hybridVideoExport` function in `src/utils/hybridExport.ts` manages the fallback chain and automatically selects the best available method based on browser capabilities and quality requirements.

## Critical Processing Notes

### Server Worker Architecture
- **`server/start.js`**: Orchestrates both Next.js app and worker processes
- **`server/worker.js`**: Bull queue worker for background video processing
- **Separation**: Web server and video worker run as separate processes in production

### File Upload Constraints
- **Railway Bandwidth**: Limited network bandwidth affects large video uploads
- **File Size Limits**: Configure multer limits based on deployment platform
- **Temporary Storage**: Videos stored in `public/uploads/` before processing, cleaned up after completion

### Processing Flow Details
1. **Upload Phase**: Videos uploaded to `/api/upload` with progress tracking
2. **Queue Phase**: Job added to Bull queue with Redis for scalability
3. **Worker Phase**: Background processing with FFmpeg segmentation
4. **Concat Phase**: Uses FFmpeg concat demuxer for seamless video joining
5. **Download Phase**: Final video served via `/api/download/[projectId]`

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.