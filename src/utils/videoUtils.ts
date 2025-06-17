import { VideoClip, TimelineSegment } from '../types';

export const generateVideoPreview = async (file: File): Promise<string> => {
  return URL.createObjectURL(file);
};

export const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.src = URL.createObjectURL(file);
  });
};

export const extractFrame = async (
  videoFile: File,
  timeInSeconds: number
): Promise<string> => {
  // Mock frame extraction - just return the video URL for now
  // In a real implementation, this would use FFmpeg to extract a specific frame
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate processing
  return URL.createObjectURL(videoFile);
};

export const generateUniqueId = (): string => {
  return Math.random().toString(36).substr(2, 9);
}; 