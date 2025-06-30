import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Play, Pause, Plus, Trash2, Music, Video, Loader2, Upload, Clock, Download, X } from 'lucide-react';
import { useVideoStore } from '../stores/videoStore';
import { generateUniqueId } from '../utils/videoUtils';
import { VideoClip, BeatMarker, TimelineSegment } from '../types';
import { toast } from 'sonner';
import { ProgressBar } from './ProgressBar';
import { uploadVideoFile, getVideoMetadata, processVideoWithBeats, processVideoWithBeatsDirect } from '../utils/ffmpeg';

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
    removeClip: storeRemoveClip,
    addBeat: storeAddBeat,
    removeBeat: storeRemoveBeat,
    addTimelineSegment,
    removeTimelineSegment,
    setCurrentClip,
    setLoading
  } = useVideoStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null); // Second video for seamless transitions
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [newBeatTime, setNewBeatTime] = useState('');
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [activeVideoRef, setActiveVideoRef] = useState<'video1' | 'video2'>('video1');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState({
    status: 'idle',
    progress: 0,
    message: '',
    projectId: null as string | null
  });

  const handleAddBeat = () => {
    const time = parseFloat(newBeatTime);
    if (!isNaN(time) && time >= 0) {
      const newBeat: BeatMarker = {
        id: generateUniqueId(),
        time
      };
      storeAddBeat(newBeat);
      setNewBeatTime('');
    }
  };

  const sortedBeats = useMemo(() => {
    const startBeat: BeatMarker = { id: 'start', time: 0 };
    return [startBeat, ...beats].sort((a, b) => a.time - b.time);
  }, [beats]);

  const videoSegments = useMemo(() => {
    if (clips.length === 0 || sortedBeats.length < 2) return [];

    const segments = [];
    for (let i = 0; i < sortedBeats.length - 1; i++) {
      const clipIndex = i % clips.length;
      const clip = clips[clipIndex];
      
      segments.push({
        clipId: clip.id,
        startTime: sortedBeats[i].time,
        endTime: sortedBeats[i + 1].time,
        videoStartTime: 0,
        videoEndTime: clip.duration
      });
    }
    return segments;
  }, [clips, sortedBeats]);

  const currentVideoClip = useMemo(() => {
    if (clips.length === 0) return null;
    
    const currentSegment = videoSegments.find(
      segment => currentTime >= segment.startTime && currentTime < segment.endTime
    );
    
    if (currentSegment) {
      return clips.find(clip => clip.id === currentSegment.clipId) || null;
    }
    
    return clips[0];
  }, [clips, videoSegments, currentTime]);

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

  // Handle video playback for both video elements
  useEffect(() => {
    const activeVideo = activeVideoRef === 'video1' ? videoRef.current : videoRef2.current;
    const inactiveVideo = activeVideoRef === 'video1' ? videoRef2.current : videoRef.current;
    
    if (!activeVideo) return;

    if (isPlaying) {
      activeVideo.play().catch(console.error);
      // Mute videos to only play the audio track
      activeVideo.muted = true;
    } else {
      activeVideo.pause();
      if (inactiveVideo) {
        inactiveVideo.pause();
      }
    }
  }, [isPlaying, activeVideoRef]);

  // Handle audio time update with seamless video transitions
  const handleAudioTimeUpdate = () => {
    if (audioRef.current && !isTransitioning) {
      const newTime = audioRef.current.currentTime;
      setCurrentTime(newTime);

      // Find current and next segments
      const currentSegmentIndex = videoSegments.findIndex(segment => 
        segment && newTime >= segment.startTime && newTime < segment.endTime
      );

      if (currentSegmentIndex !== -1) {
        const currentSegment = videoSegments[currentSegmentIndex];
        const segmentIndex = clips.findIndex(clip => clip.id === currentSegment.clipId);
        
        // Check if we need to transition to a new video
        if (segmentIndex !== currentVideoIndex) {
          setIsTransitioning(true);
          
          // Get the inactive video element
          const inactiveRef = activeVideoRef === 'video1' ? videoRef2 : videoRef;
          const activeRef = activeVideoRef === 'video1' ? videoRef : videoRef2;
          
          if (inactiveRef.current && clips[segmentIndex]) {
            // Preload the next video
            inactiveRef.current.src = clips[segmentIndex].url;
            inactiveRef.current.currentTime = 0;
            inactiveRef.current.muted = true;
            
            // Wait for the video to be ready
            inactiveRef.current.oncanplay = () => {
              // Switch videos
              setActiveVideoRef(prev => prev === 'video1' ? 'video2' : 'video1');
              setCurrentVideoIndex(segmentIndex);
              setCurrentClip(currentSegment.clipId);
              
              // Start playing the new video
              if (isPlaying) {
                inactiveRef.current?.play().catch(console.error);
              }
              
              // Pause the old video
              activeRef.current?.pause();
              
              setIsTransitioning(false);
            };
          }
        } else {
          // Update time within current video
          const activeRef = activeVideoRef === 'video1' ? videoRef : videoRef2;
          if (activeRef.current) {
            const relativeTime = newTime - currentSegment.startTime;
            const timeDiff = Math.abs(activeRef.current.currentTime - relativeTime);
            
            // Only seek if the time difference is significant (> 0.1 seconds)
            if (timeDiff > 0.1) {
              activeRef.current.currentTime = relativeTime;
            }
          }
        }
        
        // Preload next segment if we're near the end
        const timeUntilNextSegment = currentSegment.endTime - newTime;
        if (timeUntilNextSegment < 0.2 && currentSegmentIndex < videoSegments.length - 1) {
          const nextSegment = videoSegments[currentSegmentIndex + 1];
          const nextClip = clips.find(clip => clip.id === nextSegment.clipId);
          
          if (nextClip) {
            const inactiveRef = activeVideoRef === 'video1' ? videoRef2 : videoRef;
            if (inactiveRef.current && inactiveRef.current.src !== nextClip.url) {
              inactiveRef.current.src = nextClip.url;
              inactiveRef.current.load();
            }
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
    setActiveVideoRef('video1');
    
    if (clips[0]) {
      setCurrentClip(clips[0].id);
    }
    
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
    if (videoRef2.current) {
      videoRef2.current.currentTime = 0;
    }
  };

  // Handle play/pause
  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) {
      toast.error('Please upload an audio file first');
      return;
    }

    const activeVideo = activeVideoRef === 'video1' ? videoRef.current : videoRef2.current;

    if (isPlaying) {
      audioRef.current.pause();
      if (activeVideo) {
        activeVideo.pause();
      }
    } else {
      // If starting playback, ensure we're at the right position
      const currentSegment = videoSegments.find(seg => 
        currentTime >= seg.startTime && currentTime < seg.endTime
      );
      
      if (currentSegment && activeVideo) {
        const relativeTime = currentTime - currentSegment.startTime;
        activeVideo.currentTime = relativeTime;
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
      for (const file of acceptedFiles) {
        if (file.type.startsWith('video/')) {
          const clipId = generateUniqueId();
          
          // Get metadata for the video
          const metadata = await getVideoMetadata(file);
          
          // For preview, we'll still use blob URL
          // Server processing will happen during export
          const previewUrl = URL.createObjectURL(file);
          
          const newClip: VideoClip = {
            id: clipId,
            file,
            url: previewUrl,
            duration: metadata.duration,
            name: file.name
          };
          addClip(newClip);
          
          if (clips.length === 0) {
            setCurrentClip(clipId);
            setCurrentVideoIndex(0);
          }
        }
      }
      toast.success('Videos loaded for preview. Server processing will happen during export.');
    } catch (error) {
      console.error('Error loading videos:', error);
      toast.error('Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, [addClip, setCurrentClip, clips.length, setLoading]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    multiple: true
  });

  const handleExport = async () => {
    console.log('🎬 EXPORT: Button clicked', { 
      timestamp: new Date().toISOString(),
      clipsCount: clips.length,
      beatsCount: sortedBeats.length,
      clips: clips.map(c => ({ id: c.id, name: c.name, duration: c.duration })),
      beatMarkers: sortedBeats.map(b => b.time)
    });

    if (clips.length === 0) {
      console.error('🎬 EXPORT: No clips available');
      toast.error('Please add some video clips first');
      return;
    }

    if (sortedBeats.length < 2) {
      console.error('🎬 EXPORT: Insufficient beat markers', { count: sortedBeats.length });
      toast.error('Please add at least one beat marker');
      return;
    }

    console.log('🎬 EXPORT: Validation passed, starting export process...');
    setIsProcessing(true);
    setExportProgress({
      status: 'uploading',
      progress: 0,
      message: 'Preparing export...',
      projectId: null
    });

    try {
      console.log('🎬 EXPORT: Preparing videos for processing');
      
      // Prepare videos for server processing
      const videosForProcessing = clips.map(clip => ({
        file: clip.file,
        id: clip.id
      }));

      const beatMarkers = sortedBeats.map(beat => beat.time);

      console.log('🎬 EXPORT: Calling processVideoWithBeats', {
        videosCount: videosForProcessing.length,
        beatMarkersCount: beatMarkers.length,
        projectName: `Rhythm Cut Export - ${new Date().toISOString()}`
      });

      setExportProgress(prev => ({
        ...prev,
        message: 'Starting server-side processing...'
      }));

      // Use direct processing for faster exports (bypasses queue)
      const outputUrl = await processVideoWithBeatsDirect(
        videosForProcessing,
        beatMarkers,
        `Rhythm Cut Export - ${new Date().toISOString()}`,
        (progress) => {
          console.log('🎬 EXPORT: Progress update received', { progress: `${(progress * 100).toFixed(1)}%` });
          setExportProgress(prev => ({
            ...prev,
            progress: Math.round(progress * 100),
            status: 'processing',
            message: `Processing video... ${Math.round(progress * 100)}%`
          }));
        }
      );

      console.log('🎬 EXPORT: Processing completed successfully', { outputUrl });

      setExportUrl(outputUrl);
      setExportProgress({
        status: 'completed',
        progress: 100,
        message: 'Export completed successfully!',
        projectId: null
      });

      toast.success('Video exported successfully!');

      // Automatically trigger download
      console.log('🎬 EXPORT: Triggering automatic download');
      const downloadLink = document.createElement('a');
      downloadLink.href = outputUrl;
      downloadLink.download = `rhythm-cut-${Date.now()}.mp4`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      console.log('🎬 EXPORT: Download triggered successfully');

    } catch (error) {
      console.error('🎬 EXPORT: Export failed with error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      
      toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setExportProgress({
        status: 'error',
        progress: 0,
        message: 'Export failed. Please try again.',
        projectId: null
      });
    } finally {
      console.log('🎬 EXPORT: Export process finished, cleaning up');
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6 p-6 bg-gradient-to-b from-navy-900 to-blue-950 rounded-lg shadow-lg">
      {/* Main content area */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left panel - Video upload and preview */}
        <div className="col-span-8 space-y-4">
          {/* Video preview with dual video elements for seamless transitions */}
          {currentVideoClip ? (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={currentVideoClip.url}
                className={`absolute inset-0 w-full h-full transition-opacity duration-200 ${
                  activeVideoRef === 'video1' ? 'opacity-100' : 'opacity-0'
                }`}
                controls={false}
                muted={true}
                playsInline
                preload={activeVideoRef === 'video1' ? 'auto' : 'none'}
              />
              <video
                ref={videoRef2}
                className={`absolute inset-0 w-full h-full transition-opacity duration-200 ${
                  activeVideoRef === 'video2' ? 'opacity-100' : 'opacity-0'
                }`}
                controls={false}
                muted={true}
                playsInline
                preload={activeVideoRef === 'video2' ? 'auto' : 'none'}
              />
              
              {/* Playback controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/50 to-transparent">
                <div className="flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    className="p-2 rounded-full bg-[#06B6D4] hover:bg-[#0891B2] text-white"
                    disabled={!audioUrl}
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <div className="flex-1">
                    <div className="h-1 bg-white/30 rounded-full">
                      <div
                        className="h-full bg-[#06B6D4] rounded-full"
                        style={{ width: `${(currentTime / (sortedBeats[sortedBeats.length - 1]?.time || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-white text-sm">
                    {currentTime.toFixed(2)}s
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${isDragActive ? 'border-[#06B6D4] bg-[#E5F7FA]' : 'border-gray-300 hover:border-[#06B6D4]'}`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="w-12 h-12 text-[#06B6D4] animate-spin" />
                    <p className="text-gray-600">Loading videos...</p>
                  </>
                ) : (
                  <>
                    <Video className="w-12 h-12 text-[#06B6D4]" />
                    <p className="text-gray-700">
                      {isDragActive
                        ? 'Drop the videos here...'
                        : 'Drag & drop videos, or click to select'}
                    </p>
                    <p className="text-sm text-gray-500">
                      Videos will be processed on our servers for optimal performance
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Video Clips List */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-black font-semibold mb-3" style={{ color: 'black' }}>Video Clips</h3>
            <div className="space-y-2">
              {clips.map((clip, index) => (
                <div
                  key={clip.id}
                  className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-black font-medium" style={{ color: 'black' }}>
                      {index + 1}. {clip.name}
                    </span>
                    <span className="text-gray-500 text-sm">
                      ({clip.duration.toFixed(1)}s)
                    </span>
                  </div>
                  <button
                    onClick={() => storeRemoveClip(clip.id)}
                    className="p-1 text-gray-500 hover:text-red-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="col-span-4 space-y-4">
          {/* Beat Markers */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-black font-semibold mb-3" style={{ color: 'black' }}>Beat Markers (in seconds)</h3>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newBeatTime}
                onChange={(e) => setNewBeatTime(e.target.value)}
                placeholder="Time in seconds (e.g., 1.5)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-black placeholder-gray-500"
              />
              <button
                onClick={handleAddBeat}
                className="px-4 py-2 bg-[#06B6D4] text-white rounded-lg hover:bg-[#0891B2]"
              >
                Add Beat
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {sortedBeats.map((beat) => (
                <div key={beat.id} className="flex items-center justify-between bg-white p-2 rounded border">
                  <span className="text-black font-mono">{beat.time.toFixed(2)}s</span>
                  {beat.id !== 'start' && (
                    <button
                      onClick={() => storeRemoveBeat(beat.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Export Section */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-black font-semibold mb-3" style={{ color: 'black' }}>Export Video</h3>
            
            {isProcessing ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{exportProgress.message}</span>
                  <span className="text-sm font-medium">{exportProgress.progress}%</span>
                </div>
                                 <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                   <div
                     className="h-full bg-[#06B6D4] rounded-full transition-all duration-300"
                     style={{ width: `${exportProgress.progress}%` }}
                   />
                 </div>
                <p className="text-xs text-gray-500">
                  Server-side processing ensures high quality and performance
                </p>
              </div>
            ) : (
              <button
                onClick={handleExport}
                disabled={clips.length === 0 || sortedBeats.length < 2}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#06B6D4] text-white rounded-lg hover:bg-[#0891B2] disabled:opacity-50 disabled:hover:bg-[#06B6D4]"
              >
                <Download size={20} />
                Export Video
              </button>
            )}
            
            {exportUrl && (
              <div className="mt-3 p-2 bg-green-100 border border-green-300 rounded">
                <p className="text-sm text-green-700">
                  Export completed! Download should start automatically.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}; 