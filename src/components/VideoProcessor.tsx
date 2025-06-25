import React, { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { useVideoStore } from '../stores/videoStore';
import { ProcessingModal } from './ProcessingModal';
import { uploadVideoFile, getVideoMetadata } from '../utils/ffmpeg';
import { generateThumbnails, isVideoSupported } from '../utils/videoOptimization';

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
      setProcessingProgress({
        value: 0.1,
        message: 'Analyzing video...'
      });
      
      const metadata = await getVideoMetadata(file);
      
      // Upload video to server
      setProcessingProgress({
        value: 0.3,
        message: 'Uploading video to server...'
      });
      
      const serverUrl = await uploadVideoFile(file);
      
      // Generate thumbnails using server-side processing
      setProcessingProgress({
        value: 0.6,
        message: 'Generating thumbnails...'
      });
      
      const thumbnails = await generateThumbnails(file, metadata.duration);
      setThumbnailUrls(thumbnails.map(t => t.url));
      
      setProcessingProgress({
        value: 0.9,
        message: 'Finalizing...'
      });
      
      // Add to store with server URL
      addVideo({
        id: Date.now().toString(),
        url: serverUrl, // Use server URL instead of blob URL
        thumbnails: thumbnails.map(t => ({ time: t.time, url: t.url })),
        duration: metadata.duration
      });
      
      setProcessingProgress({
        value: 1,
        message: 'Video processed successfully!'
      });
      
      toast.success('Video processed and uploaded successfully!');
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
          Supports MP4, WebM, MOV, and AVI formats. Processing happens on our servers for optimal performance.
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