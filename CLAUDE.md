# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rhythm Cut is a Next.js-based video editing application that allows users to create beat-synchronized video edits. Users upload multiple videos, set beat markers, and the app automatically switches between videos at specified timestamps.

## Commands

### Development
```bash
npm run dev        # Start development server (http://localhost:3000)
npm run build      # Build for production
npm run start      # Start production server
npm run lint       # Run ESLint
```

### Database
```bash
npx prisma generate      # Generate Prisma client
npx prisma db push       # Push schema changes to database
npx prisma migrate dev   # Create and apply migrations
```

## Architecture

### Video Processing
- Uses FFmpeg for server-side video processing
- Direct processing via `/api/process-direct` endpoint
- File uploads handled via `/api/upload`
- Downloads served via `/api/download/[projectId]`

### Authentication
- NextAuth v4 with Google OAuth
- Optional authentication for some features
- Anonymous usage supported for direct exports

### Database
- PostgreSQL with Prisma ORM
- User and Project models
- Beat markers stored as arrays

## Common Issues

### Export Problems
- Ensure FFmpeg is available in deployment environment
- Check file permissions for uploads/exports directories
- Verify toast messages are visible (black text on white background)

### Toast Messages
- Configured in `app/layout.tsx` with black text styling
- Additional CSS overrides in `app/globals.css`
- Uses Sonner library for notifications

## Environment Variables

```bash
DATABASE_URL          # PostgreSQL connection
REDIS_URL            # Redis for job queue
NEXTAUTH_URL         # Authentication URL
NEXTAUTH_SECRET      # Auth secret
GOOGLE_CLIENT_ID     # Google OAuth
GOOGLE_CLIENT_SECRET # Google OAuth
```