# Rhythm Cut

A video editing tool that lets you cut and combine videos based on beat markers. Perfect for creating rhythm-based video edits.

## Features

- Upload multiple videos
- Set beat markers in seconds
- Automatic video switching at beat markers
- Real-time preview
- Export final video

## How to Use

1. Upload Videos:
   - Upload your videos in the order you want them to play
   - Each video will be assigned a number (Video 1, Video 2, etc.)

2. Add Beat Markers:
   - Enter times in seconds (e.g., "1" for 1 second)
   - Click "Add Beat" to add the marker
   - Videos will switch at these exact times

3. Preview:
   - Use the play/pause button to preview your edit
   - The progress bar shows overall timeline progress
   - Current time is displayed in seconds

4. Export:
   - Click "Export Video" to save your edit
   - The final video will be downloaded as a WebM file

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Technologies Used

- Next.js
- React
- TypeScript
- Tailwind CSS
- Web APIs (MediaRecorder, Canvas)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
