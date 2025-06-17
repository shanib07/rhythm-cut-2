import React, { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { useVideoStore } from '../stores/videoStore';
import { ProcessingModal } from './ProcessingModal';

interface VideoProcessorProps {
  onProcessingComplete: () => void;
}

// Types for video processing
interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

interface ProcessingOptions {
  targetWidth?: number;
  targetHeight?: number;
  quality?: number;
}

interface Thumbnail {
  time: number;
  url: string;
}

// Mock video processing functions
const mockProcessVideo = async (
  file: File,
  options: ProcessingOptions,
  onProgress: (progress: number) => void
): Promise<Blob> => {
  // Simulate video processing with delays
  const totalSteps = 10;
  for (let step = 0; step < totalSteps; step++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    onProgress((step + 1) / totalSteps);
  }
  
  // TODO: Replace with actual FFmpeg processing
  // Example FFmpeg command that would be used:
  // ffmpeg -i input.mp4 -vf scale=1280:720 -c:v libx264 -crf 23 -preset medium -c:a aac output.mp4
  
  // For now, just return the original file
  return file;
};

const mockGenerateThumbnails = async (file: File, duration: number): Promise<Thumbnail[]> => {
  // Create a video element to generate thumbnails
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  
  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });
  
  // Generate 3 thumbnails at different points
  const thumbnailTimes = [0, duration / 2, duration * 0.9];
  const thumbnails: Thumbnail[] = [];
  
  for (const time of thumbnailTimes) {
    // TODO: Replace with actual FFmpeg thumbnail generation
    // Example FFmpeg command:
    // ffmpeg -i input.mp4 -ss {time} -vframes 1 thumbnail.jpg
    
    // For now, create a mock thumbnail using the first frame
    thumbnails.push({
      time,
      url: URL.createObjectURL(file)
    });
  }
  
  URL.revokeObjectURL(video.src);
  return thumbnails;
};

const isVideoSupported = (file: File): boolean => {
  const supportedFormats = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
  return supportedFormats.includes(file.type);
};

export const VideoProcessor: React.FC<VideoProcessorProps> = ({ onProcessingComplete }) => {
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([]);
  
  const {
    addVideo,
    setError,
    isProcessing,
    setProcessing,
    setProcessingProgress
  } = useVideoStore();
  
  // Cleanup resources on unmount
  useEffect(() => {
    return () => {
      thumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [thumbnailUrls]);
  
  const processVideo = useCallback(async (file: File) => {
    if (!isVideoSupported(file)) {
      toast.error('Unsupported video format. Please use MP4, WebM, MOV, or AVI.');
      return;
    }
    
    setProcessing(true);
    setProcessingProgress({ value: 0, message: 'Loading video...' });
    
    try {
      // Get video metadata
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });
      const duration = video.duration;
      URL.revokeObjectURL(video.src);
      
      // Generate thumbnails
      setProcessingProgress({
        value: 0.3,
        message: 'Generating thumbnails...'
      });
      
      const thumbnails = await mockGenerateThumbnails(file, duration);
      setThumbnailUrls(thumbnails.map(t => t.url));
      
      // Process video
      setProcessingProgress({
        value: 0.5,
        message: 'Processing video...'
      });
      
      const processedVideo = await mockProcessVideo(
        file,
        {
          targetWidth: 1280,
          targetHeight: 720,
          quality: 0.8
        },
        (progress) => {
          setProcessingProgress({
            value: 0.5 + progress * 0.5,
            message: 'Processing video...'
          });
        }
      );
      
      // Add to store
      const videoUrl = URL.createObjectURL(processedVideo);
      addVideo({
        id: Date.now().toString(),
        url: videoUrl,
        thumbnails: thumbnails.map(t => ({ time: t.time, url: t.url })),
        duration
      });
      
      toast.success('Video processed successfully!');
      onProcessingComplete();
    } catch (error) {
      console.error('Video processing error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      toast.error('Failed to process video. Please try again.');
    } finally {
      setProcessing(false);
      setProcessingProgress(null);
    }
  }, [addVideo, onProcessingComplete, setError, setProcessing, setProcessingProgress]);
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'video/*': ['.mp4', '.webm', '.mov', '.avi']
    },
    maxFiles: 1,
    onDrop: async (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (file) {
        await processVideo(file);
      }
    }
  });
  
  return (
    <>
      <div
        {...getRootProps()}
        className={`p-8 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-primary bg-primary/10' : 'border-gray-300 hover:border-primary'}`}
      >
        <input {...getInputProps()} />
        <p className="text-lg mb-2">
          {isDragActive ? 'Drop the video here' : 'Drag & drop a video, or click to select'}
        </p>
        <p className="text-sm text-gray-500">
          Supports MP4, WebM, MOV, and AVI formats
        </p>
      </div>
      
      {isProcessing && (
        <ProcessingModal
          progress={useVideoStore.getState().processingProgress?.value || 0}
          message={useVideoStore.getState().processingProgress?.message}
          onCancel={() => setProcessing(false)}
        />
      )}
    </>
  );
}; 