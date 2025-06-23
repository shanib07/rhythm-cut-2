import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Play, Pause, Download, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useVideoStore } from '../stores/videoStore';
import { VideoClip, BeatMarker } from '../types';
import { toast } from 'sonner';

interface ProcessingJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  estimatedTime?: string;
  result?: string;
  error?: string;
}

export const ImprovedVideoEditor: React.FC = () => {
  const {
    clips = [],
    beats = [],
    audioFile,
    audioUrl,
    addClip,
    removeClip
  } = useVideoStore();

  const [processingJob, setProcessingJob] = useState<ProcessingJob | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Sort beats and ensure we have a start beat
  const sortedBeats = useMemo(() => {
    const allBeats = beats.some(b => b.time === 0) 
      ? [...beats] 
      : [{ id: 'start', time: 0 }, ...beats];
    return allBeats.sort((a, b) => a.time - b.time);
  }, [beats]);

  // Calculate video segments
  const videoSegments = useMemo(() => {
    if (!clips.length || !sortedBeats.length) return [];

    return clips.map((clip, index) => {
      const startBeat = sortedBeats[index];
      const endBeat = sortedBeats[index + 1];
      
      if (!startBeat) return null;

      return {
        id: clip.id,
        startTime: startBeat.time,
        endTime: endBeat ? endBeat.time : startBeat.time + Math.min(clip.duration, 10), // Limit to 10s
        videoUrl: clip.url,
        videoFile: clip.file
      };
    }).filter(Boolean);
  }, [clips, sortedBeats]);

  // File upload handling with size limits
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setIsUploading(true);
    
    try {
      for (const file of acceptedFiles) {
        // Check file size (limit to 100MB for better performance)
        if (file.size > 100 * 1024 * 1024) {
          toast.error(`File ${file.name} is too large (max 100MB)`);
          continue;
        }

        if (file.type.startsWith('video/')) {
          const clipId = `clip_${Date.now()}_${Math.random()}`;
          
          // Create optimized preview URL
          const url = URL.createObjectURL(file);
          
          // Get video duration efficiently
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.src = url;
          
          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => {
              const newClip: VideoClip = {
                id: clipId,
                file,
                url,
                duration: video.duration,
                name: file.name
              };
              addClip(newClip);
              resolve();
            };
          });
        }
      }
    } catch (error) {
      console.error('Error loading videos:', error);
      toast.error('Error loading videos');
    } finally {
      setIsUploading(false);
    }
  }, [addClip]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    multiple: true,
    maxSize: 100 * 1024 * 1024 // 100MB limit
  });

  // Process video using server-side API
  const processVideo = async () => {
    if (!audioFile || !videoSegments.length) {
      toast.error('Please upload audio and video files first');
      return;
    }

    try {
      setProcessingJob({
        id: '',
        status: 'pending',
        progress: 0
      });

      // Upload files to server first (would typically use presigned URLs)
      const formData = new FormData();
      formData.append('audio', audioFile);
      
      videoSegments.forEach((segment, index) => {
        if (segment?.videoFile) {
          formData.append(`video_${index}`, segment.videoFile);
        }
      });

      // Start processing job
      const response = await fetch('/api/process-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioUrl: audioUrl,
          videoSegments: videoSegments.map(seg => ({
            videoUrl: seg?.videoUrl || '',
            startTime: seg?.startTime || 0,
            endTime: seg?.endTime || 0
          }))
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setProcessingJob({
          id: result.jobId,
          status: 'processing',
          progress: 0,
          estimatedTime: result.estimatedTime
        });

        // Poll for status
        pollJobStatus(result.jobId);
        toast.success('Video processing started!');
      } else {
        throw new Error(result.error);
      }

    } catch (error) {
      console.error('Processing error:', error);
      toast.error('Failed to start video processing');
      setProcessingJob(null);
    }
  };

  // Poll job status
  const pollJobStatus = (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/process-video?jobId=${jobId}`);
        const status = await response.json();

        if (status.success) {
          setProcessingJob(prev => prev ? {
            ...prev,
            status: status.status,
            progress: status.progress,
            estimatedTime: status.estimatedTimeRemaining
          } : null);

          if (status.status === 'completed') {
            clearInterval(interval);
            toast.success('Video processing completed!');
            // Handle download
          } else if (status.status === 'failed') {
            clearInterval(interval);
            toast.error('Video processing failed');
            setProcessingJob(null);
          }
        }
      } catch (error) {
        console.error('Status check failed:', error);
        clearInterval(interval);
      }
    }, 2000);

    // Cleanup after 10 minutes
    setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">High-Performance Video Editor</h2>
        <p className="text-gray-400">Server-side processing for faster, more reliable video editing</p>
      </div>

      {/* Processing Status */}
      {processingJob && (
        <div className="bg-[#1E293B] p-6 rounded-lg border border-[#334155]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {processingJob.status === 'processing' && (
                <div className="animate-spin w-5 h-5 border-2 border-[#06B6D4] border-t-transparent rounded-full" />
              )}
              {processingJob.status === 'completed' && (
                <CheckCircle className="w-5 h-5 text-green-500" />
              )}
              {processingJob.status === 'failed' && (
                <AlertCircle className="w-5 h-5 text-red-500" />
              )}
              <span className="text-white font-medium">
                {processingJob.status === 'pending' && 'Preparing...'}
                {processingJob.status === 'processing' && 'Processing Video...'}
                {processingJob.status === 'completed' && 'Completed!'}
                {processingJob.status === 'failed' && 'Failed'}
              </span>
            </div>
            {processingJob.estimatedTime && (
              <span className="text-gray-400 text-sm flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {processingJob.estimatedTime}
              </span>
            )}
          </div>
          
          <div className="w-full bg-[#334155] rounded-full h-2">
            <div 
              className="bg-[#06B6D4] h-2 rounded-full transition-all duration-500"
              style={{ width: `${processingJob.progress}%` }}
            />
          </div>
          <p className="text-gray-300 text-sm mt-2">
            {processingJob.progress}% complete
          </p>
        </div>
      )}

      {/* Video Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Upload Videos</h3>
          
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
              ${isDragActive 
                ? 'border-[#06B6D4] bg-[#06B6D4]/10' 
                : 'border-[#334155] hover:border-[#06B6D4]/50'
              }`}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 text-[#06B6D4] mx-auto mb-4" />
            <p className="text-white mb-2">
              {isDragActive ? 'Drop videos here...' : 'Drag & drop videos, or click to select'}
            </p>
            <p className="text-gray-400 text-sm">Max 100MB per file for optimal performance</p>
          </div>

          {/* Video List */}
          {clips.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-white font-medium">Uploaded Videos ({clips.length})</h4>
              {clips.map((clip, index) => (
                <div key={clip.id} className="bg-[#1E293B] p-3 rounded-lg border border-[#334155]">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-white font-medium">{clip.name}</p>
                      <p className="text-gray-400 text-sm">
                        Duration: {clip.duration.toFixed(1)}s | 
                        Size: {(clip.file.size / (1024 * 1024)).toFixed(1)}MB
                      </p>
                    </div>
                    <button
                      onClick={() => removeClip(clip.id)}
                      className="text-red-400 hover:text-red-300 px-2 py-1"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timeline Preview */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Timeline Preview</h3>
          
          {videoSegments.length > 0 ? (
            <div className="space-y-3">
              {videoSegments.map((segment, index) => (
                <div key={segment?.id} className="bg-[#1E293B] p-4 rounded-lg border border-[#334155]">
                  <h4 className="text-white font-medium mb-2">Segment {index + 1}</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Start:</span>
                      <span className="text-white ml-2">{segment?.startTime.toFixed(1)}s</span>
                    </div>
                    <div>
                      <span className="text-gray-400">End:</span>
                      <span className="text-white ml-2">{segment?.endTime.toFixed(1)}s</span>
                    </div>
                  </div>
                </div>
              ))}
              
              <button
                onClick={processVideo}
                disabled={!audioFile || processingJob?.status === 'processing'}
                className="w-full bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                {processingJob?.status === 'processing' ? 'Processing...' : 'Start Processing'}
              </button>
            </div>
          ) : (
            <div className="bg-[#1E293B] p-8 rounded-lg border border-[#334155] text-center">
              <p className="text-gray-400">Upload videos and audio to see timeline preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}; 