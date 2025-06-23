import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Play, Pause, Plus, Trash2, Music, Video, Loader2, Upload, Clock, Download } from 'lucide-react';
import { useVideoStore } from '../stores/videoStore';
import { generateUniqueId } from '../utils/videoUtils';
import { VideoClip, BeatMarker, TimelineSegment } from '../types';
import { toast } from 'sonner';

interface VideoFile {
  file: File;
  preview: string;
}

export const VideoEditor: React.FC = () => {
  const {
    clips = [],
    beats = [],
    timeline = [],
    currentClip,
    isLoading,
    audioUrl,
    audioBuffer,
    addClip,
    removeClip,
    addBeat,
    removeBeat,
    addTimelineSegment,
    removeTimelineSegment,
    setCurrentClip,
    setLoading
  } = useVideoStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [newBeatTime, setNewBeatTime] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // Sort beats and add 0 if not present
  const sortedBeats = useMemo(() => {
    const allBeats = beats.some(b => b.time === 0) 
      ? [...beats] 
      : [{ id: 'start', time: 0 }, ...beats];
    return allBeats.sort((a, b) => a.time - b.time);
  }, [beats]);

  // Calculate video segments based on beats and clips
  const videoSegments = useMemo(() => {
    if (!clips.length || !sortedBeats.length) return [];

    return clips.map((clip, index) => {
      const startBeat = sortedBeats[index];
      const endBeat = sortedBeats[index + 1];
      
      if (!startBeat) return null;

      return {
        clipId: clip.id,
        startTime: startBeat.time,
        endTime: endBeat ? endBeat.time : startBeat.time + clip.duration,
        videoStartTime: 0,
        videoEndTime: endBeat ? endBeat.time - startBeat.time : clip.duration
      };
    }).filter(Boolean);
  }, [clips, sortedBeats]);

  // Initialize audio element
  useEffect(() => {
    if (!audioRef.current && audioUrl) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.addEventListener('timeupdate', handleAudioTimeUpdate);
      audioRef.current.addEventListener('ended', handleAudioEnded);
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener('timeupdate', handleAudioTimeUpdate);
        audioRef.current.removeEventListener('ended', handleAudioEnded);
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [audioUrl]);

  // Handle video playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(console.error);
      // Mute video to only play the audio track
      video.muted = true;
    } else {
      video.pause();
    }
  }, [isPlaying, currentVideoIndex]);

  // Handle audio time update
  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      const newTime = audioRef.current.currentTime;
      setCurrentTime(newTime);

      // Find and switch to the appropriate video segment based on audio time
      const currentSegment = videoSegments.find(segment => 
        segment && newTime >= segment.startTime && newTime < segment.endTime
      );

      if (currentSegment) {
        const segmentIndex = clips.findIndex(clip => clip.id === currentSegment.clipId);
        
        if (segmentIndex !== currentVideoIndex) {
          setCurrentVideoIndex(segmentIndex);
          setCurrentClip(currentSegment.clipId);
          
          // Set the correct time within the video
          if (videoRef.current) {
            const relativeTime = newTime - currentSegment.startTime;
            videoRef.current.currentTime = relativeTime;
          }
        }
      }
    }
  };

  // Handle audio ended
  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentVideoIndex(0);
    if (clips[0]) {
      setCurrentClip(clips[0].id);
    }
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  // Handle play/pause
  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) {
      toast.error('Please upload an audio file first');
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
      if (videoRef.current) {
        videoRef.current.pause();
      }
    } else {
      // If starting playback, ensure we're at the right position
      const currentSegment = videoSegments[currentVideoIndex];
      if (currentSegment && videoRef.current) {
        const relativeTime = currentTime - currentSegment.startTime;
        videoRef.current.currentTime = relativeTime;
      }
      audioRef.current.play().catch(error => {
        console.error('Error playing audio:', error);
        toast.error('Error playing audio');
      });
    }
    setIsPlaying(!isPlaying);
  };

  // Video upload handling
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setLoading(true);
    try {
      const newVideos = await Promise.all(
        acceptedFiles.map(async (file) => ({
          file,
          preview: URL.createObjectURL(file)
        }))
      );
      setVideos([...videos, ...newVideos]);
    } catch (error) {
      console.error('Error loading videos:', error);
    } finally {
      setLoading(false);
    }
  }, [videos, setLoading]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.avi']
    },
    multiple: true
  });

  // Beat management
  const handleAddBeat = useCallback(() => {
    if (!newBeatTime.trim()) return;
    
    try {
      const seconds = parseFloat(newBeatTime);
      
      if (isNaN(seconds) || seconds < 0) {
        toast.error('Please enter a valid positive number');
        return;
      }
      
      // Check if this time is already used
      if (beats.some(b => b.time === seconds)) {
        toast.error('Beat time already exists');
        return;
      }

      const newBeat: BeatMarker = {
        id: generateUniqueId(),
        time: seconds
      };
      addBeat(newBeat);
      setNewBeatTime(''); // Clear input after adding

      // If we have more videos than segments, automatically assign the next video
      if (clips.length > timeline.length) {
        const clipToAssign = clips[timeline.length];
        const beatIndex = beats.length; // New beat will be at this index after adding
        
        const startTime = beatIndex === 0 ? 0 : seconds;
        const endTime = seconds + clipToAssign.duration;

        const newSegment: TimelineSegment = {
          id: generateUniqueId(),
          clipId: clipToAssign.id,
          beatStart: startTime,
          beatEnd: endTime,
          clipStartTime: 0,
          clipEndTime: clipToAssign.duration
        };
        addTimelineSegment(newSegment);
      }
    } catch (error) {
      toast.error('Invalid time format');
    }
  }, [newBeatTime, addBeat, clips, timeline, addTimelineSegment, beats]);

  const currentVideoClip = currentClip ? clips.find(c => c.id === currentClip) : null;

  const exportVideo = async () => {
    if (!clips.length || !sortedBeats.length || !videoSegments.length) {
      toast.error('Please add videos and beat markers before exporting');
      return;
    }

    if (!audioUrl) {
      toast.error('Please upload an audio file before exporting');
      return;
    }

    setIsExporting(true);
    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        throw new Error('Canvas not available');
      }

      // Create an audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioDestination = audioContext.createMediaStreamDestination();

      // Load and connect the audio file
      const audioResponse = await fetch(audioUrl);
      const audioArrayBuffer = await audioResponse.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);
      
      // Create audio source from the buffer
      const audioSource = audioContext.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.connect(audioDestination);
      
      // Set canvas size to match the first video's dimensions
      const firstClip = clips[0];
      const video = document.createElement('video');
      video.src = firstClip.url;
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          resolve(null);
        };
      });

      // Create a combined video+audio stream
      const canvasStream = canvas.captureStream(60);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);

      // Try to use MP4 with H.264, fallback to other formats if not supported
      const mimeTypes = [
        'video/mp4;codecs=h264,aac',
        'video/mp4;codecs=h264,mp3',
        'video/mp4',
        'video/webm;codecs=h264,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ];

      let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
      if (!selectedMimeType) {
        throw new Error('No supported video codec found');
      }

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 8000000 // 8 Mbps
      });

      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const chunks = recordedChunksRef.current;
        const blob = new Blob(chunks, { type: selectedMimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'edited-video.mp4';
        a.click();
        URL.revokeObjectURL(url);
        
        // Clean up audio context
        await audioContext.close();
        
        setIsExporting(false);
        toast.success('Video export completed with audio!');
      };

      // Start recording with smaller timeslice for more frequent ondataavailable events
      mediaRecorder.start(1000);

      // Start audio playback
      audioSource.start(0);

      // Process each segment with precise timing
      for (const segment of videoSegments) {
        if (!segment) continue;

        const clip = clips.find(c => c.id === segment.clipId);
        if (!clip) continue;

        const video = document.createElement('video');
        video.src = clip.url;
        video.muted = true; // Ensure video is muted
        
        await new Promise<void>((resolve) => {
          video.onloadeddata = async () => {
            video.currentTime = segment.videoStartTime;
            
            const segmentDuration = segment.endTime - segment.startTime;
            const startTime = performance.now();
            const frameInterval = 1000 / 60; // 60 FPS
            
            const processFrame = async () => {
              const elapsed = (performance.now() - startTime) / 1000;
              if (elapsed >= segmentDuration) {
                resolve();
                return;
              }

              // Calculate the current time within the video
              const videoTime = segment.videoStartTime + elapsed;
              if (videoTime <= segment.videoEndTime) {
                video.currentTime = videoTime;
                
                // Clear canvas before drawing new frame
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Draw video frame
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              }

              // Schedule next frame with precise timing
              setTimeout(() => requestAnimationFrame(processFrame), frameInterval);
            };

            // Start video playback
            await video.play();
            processFrame();
          };
        });

        // Small pause between segments to ensure clean transitions
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Stop recording after all segments are processed
      mediaRecorder.stop();
    } catch (error) {
      console.error('Error exporting video:', error);
      toast.error('Failed to export video');
      setIsExporting(false);
    }
  };

  const handlePreview = async () => {
    if (videos.length === 0) return;
    
    // For now, just play the first video
    const video = document.getElementById('preview') as HTMLVideoElement;
    if (video) {
      video.play();
    }
  };

  const handleExport = async () => {
    if (videos.length === 0) return;
    
    setIsProcessing(true);
    try {
      // Create FormData with videos
      const formData = new FormData();
      videos.forEach((video, index) => {
        formData.append(`video${index}`, video.file);
      });

      // Send to our API
      const response = await fetch('/api/process', {
        method: 'POST',
        body: JSON.stringify({
          name: 'My Video Project',
          inputVideos: videos.map(v => URL.createObjectURL(v.file)),
          beatMarkers: [0, 2, 4, 6] // Example markers every 2 seconds
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setExportUrl(data.outputUrl);
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export video. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Upload Section */}
      <div
        {...getRootProps()}
        className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors"
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <p className="text-gray-300">Drag & drop videos here, or click to select files</p>
      </div>

      {/* Preview Section */}
      {videos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-white">Preview</h2>
          <div className="aspect-video bg-black rounded-lg overflow-hidden">
            <video
              id="preview"
              src={videos[0].preview}
              className="w-full h-full"
              controls
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-4">
        <button
          onClick={handlePreview}
          disabled={videos.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="h-5 w-5" />
          Preview
        </button>
        
        <button
          onClick={handleExport}
          disabled={videos.length === 0 || isProcessing}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="h-5 w-5" />
          {isProcessing ? 'Processing...' : 'Export'}
        </button>
      </div>

      {/* Export URL */}
      {exportUrl && (
        <div className="mt-4 p-4 bg-gray-800 rounded-lg">
          <p className="text-green-400">Export complete! Download your video:</p>
          <a
            href={exportUrl}
            download
            className="text-blue-400 hover:underline break-all"
          >
            {exportUrl}
          </a>
        </div>
      )}
    </div>
  );
}; 