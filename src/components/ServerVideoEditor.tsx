import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Upload, Play, Pause, Download, Clock, AlertCircle, CheckCircle, Eye } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { useVideoStore } from '../stores/videoStore';
import { VideoClip } from '../types';

interface ProcessingStatus {
  status: 'pending' | 'processing' | 'completed' | 'error';
  projectId?: string;
  outputUrl?: string;
}

export const ServerVideoEditor: React.FC = () => {
  const {
    clips = [],
    beats = [],
    addClip,
    removeClip
  } = useVideoStore();

  const [isUploading, setIsUploading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const [activeClipIndex, setActiveClipIndex] = useState(0);

  // Sort beats and ensure we have a start beat
  const sortedBeats = useMemo(() => {
    const allBeats = beats.some(b => b.time === 0) 
      ? [...beats] 
      : [{ id: 'start', time: 0 }, ...beats];
    return allBeats.sort((a, b) => a.time - b.time);
  }, [beats]);

  // File upload handling
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setIsUploading(true);
    
    try {
      for (const file of acceptedFiles) {
        if (file.size > 500 * 1024 * 1024) {
          toast.error(`File ${file.name} is too large (max 500MB)`);
          continue;
        }

        if (file.type.startsWith('video/')) {
          const clipId = `clip_${Date.now()}_${Math.random()}`;
          const url = URL.createObjectURL(file);
          
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
      toast.success('Videos uploaded successfully');
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
    maxSize: 500 * 1024 * 1024
  });

  // Preview functionality
  const handlePreview = useCallback(() => {
    if (!clips.length || !sortedBeats.length) {
      toast.error('Please upload videos and add beat markers');
      return;
    }

    const video = previewRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  }, [clips, sortedBeats, isPlaying]);

  // Handle video time update
  const handleTimeUpdate = useCallback(() => {
    const video = previewRef.current;
    if (!video) return;

    setCurrentTime(video.currentTime);
    
    // Find current clip based on beat markers
    const currentBeatIndex = sortedBeats.findIndex((beat, index) => {
      const nextBeat = sortedBeats[index + 1];
      return video.currentTime >= beat.time && (!nextBeat || video.currentTime < nextBeat.time);
    });

    if (currentBeatIndex !== -1 && currentBeatIndex !== activeClipIndex) {
      setActiveClipIndex(currentBeatIndex);
      video.src = clips[currentBeatIndex]?.url || '';
      video.currentTime = video.currentTime - sortedBeats[currentBeatIndex].time;
    }
  }, [sortedBeats, clips, activeClipIndex]);

  // Export functionality
  const handleExport = async () => {
    if (!clips.length || !sortedBeats.length) {
      toast.error('Please upload videos and add beat markers');
      return;
    }

    try {
      setProcessingStatus({ status: 'pending' });

      // Upload files to temporary storage
      const uploadPromises = clips.map(async (clip) => {
        const formData = new FormData();
        formData.append('file', clip.file);
        
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload ${clip.name}`);
        }
        
        const { url } = await uploadResponse.json();
        return url;
      });

      const uploadedVideoUrls = await Promise.all(uploadPromises);

      // Start processing
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Video Edit',
          inputVideos: uploadedVideoUrls,
          beatMarkers: sortedBeats.map(beat => beat.time)
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start processing');
      }

      const { projectId } = await response.json();
      setProcessingStatus({ status: 'processing', projectId });
      toast.success('Export started! This may take a few minutes.');

      // Start polling for status
      startStatusPolling(projectId);

    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export video');
      setProcessingStatus({ status: 'error' });
    }
  };

  // Poll for processing status
  const startStatusPolling = (projectId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/status/${projectId}`);
        const data = await response.json();

        if (data.status === 'completed') {
          clearInterval(pollInterval);
          setProcessingStatus({
            status: 'completed',
            projectId,
            outputUrl: data.outputUrl
          });
          toast.success('Video export completed!');
        } else if (data.status === 'error') {
          clearInterval(pollInterval);
          setProcessingStatus({ status: 'error' });
          toast.error('Video export failed');
        }
      } catch (error) {
        console.error('Status polling error:', error);
      }
    }, 5000);
  };

  return (
    <div className="space-y-6 p-4">
      {/* Upload Area */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-2 text-sm text-gray-600">
          {isDragActive
            ? 'Drop the videos here...'
            : 'Drag & drop videos here, or click to select'}
        </p>
      </div>

      {/* Video Preview */}
      {clips.length > 0 && (
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          <video
            ref={previewRef}
            src={clips[activeClipIndex]?.url}
            className="w-full h-full"
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
          />
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-4">
            <button
              onClick={handlePreview}
              className="bg-white/90 hover:bg-white p-2 rounded-full"
            >
              {isPlaying ? (
                <Pause className="h-6 w-6 text-black" />
              ) : (
                <Play className="h-6 w-6 text-black" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Video Clips List */}
      <div className="space-y-2">
        {clips.map((clip, index) => (
          <div
            key={clip.id}
            className={`flex items-center justify-between p-3 rounded-lg ${
              index === activeClipIndex ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
            }`}
          >
            <div className="flex items-center space-x-3">
              <span className="text-sm font-medium">{index + 1}.</span>
              <span className="text-sm text-gray-600">{clip.name}</span>
            </div>
            <button
              onClick={() => removeClip(clip.id)}
              className="text-red-500 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between items-center">
        <button
          onClick={handlePreview}
          disabled={!clips.length || !sortedBeats.length}
          className={`px-4 py-2 rounded-lg flex items-center space-x-2 ${
            !clips.length || !sortedBeats.length
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          <Eye className="h-4 w-4" />
          <span>Preview</span>
        </button>

        <button
          onClick={handleExport}
          disabled={!clips.length || !sortedBeats.length || processingStatus?.status === 'processing'}
          className={`px-4 py-2 rounded-lg flex items-center space-x-2 ${
            !clips.length || !sortedBeats.length || processingStatus?.status === 'processing'
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-green-500 hover:bg-green-600 text-white'
          }`}
        >
          {processingStatus?.status === 'processing' ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              <span>Export</span>
            </>
          )}
        </button>
      </div>

      {/* Processing Status */}
      {processingStatus && (
        <div className="mt-4 p-4 rounded-lg bg-gray-50">
          <div className="flex items-center space-x-2">
            {processingStatus.status === 'pending' && (
              <Clock className="h-5 w-5 text-yellow-500" />
            )}
            {processingStatus.status === 'processing' && (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
            )}
            {processingStatus.status === 'completed' && (
              <CheckCircle className="h-5 w-5 text-green-500" />
            )}
            {processingStatus.status === 'error' && (
              <AlertCircle className="h-5 w-5 text-red-500" />
            )}
            <span className="capitalize">{processingStatus.status}</span>
          </div>

          {processingStatus.status === 'completed' && processingStatus.outputUrl && (
            <a
              href={processingStatus.outputUrl}
              download
              className="mt-4 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center space-x-2 w-full justify-center"
            >
              <Download className="h-4 w-4" />
              <span>Download Final Video</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
};