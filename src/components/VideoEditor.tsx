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
    audioFile,
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [newBeatTime, setNewBeatTime] = useState('');
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
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
  const [exportQuality, setExportQuality] = useState<'fast' | 'balanced' | 'high'>('balanced');
  const [lastUpdateTime, setLastUpdateTime] = useState(0);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      
      // Cleanup timeout to prevent memory leaks
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, [audioUrl]);

  // Handle video playback - simplified single video approach
  useEffect(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.play().catch(console.error);
      // Mute video to only play the audio track
      videoRef.current.muted = true;
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  // Handle audio time update with throttling for better performance
  const handleAudioTimeUpdate = () => {
    if (!audioRef.current || isTransitioning) return;
    
    const now = Date.now();
    // Throttle updates to every 100ms for better performance
    if (now - lastUpdateTime < 100) return;
    setLastUpdateTime(now);

    const newTime = audioRef.current.currentTime;
    setCurrentTime(newTime);

    // Find current segment with simplified logic
    const currentSegmentIndex = videoSegments.findIndex(segment => 
      segment && newTime >= segment.startTime && newTime < segment.endTime
    );

    if (currentSegmentIndex !== -1) {
      const currentSegment = videoSegments[currentSegmentIndex];
      const segmentClipIndex = clips.findIndex(clip => clip.id === currentSegment.clipId);
      
      // Only switch video if we're on a different clip and transition isn't too frequent
      if (segmentClipIndex !== currentVideoIndex && segmentClipIndex >= 0) {
        setIsTransitioning(true);
        setCurrentVideoIndex(segmentClipIndex);
        setCurrentClip(currentSegment.clipId);
        
        // Simple video switching - just change src
        if (videoRef.current && clips[segmentClipIndex]) {
          videoRef.current.src = clips[segmentClipIndex].url;
          videoRef.current.muted = true;
          
          // Use debounced seeking for smoother performance
          debouncedSeek(videoRef.current, 0);
          
          if (isPlaying) {
            // Small delay to ensure video is ready
            setTimeout(() => {
              videoRef.current?.play().catch(console.error);
            }, 100);
          }
        }
        
        // Quick transition end
        setTimeout(() => setIsTransitioning(false), 200);
      } else if (videoRef.current && !isTransitioning) {
        // Update time within current video using debounced seeking
        const relativeTime = newTime - currentSegment.startTime;
        const timeDiff = Math.abs(videoRef.current.currentTime - relativeTime);
        
        // Only seek if difference is significant and not currently seeking
        if (timeDiff > 0.3 && !videoRef.current.seeking) {
          debouncedSeek(videoRef.current, relativeTime);
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
      const currentSegment = videoSegments.find(seg => 
        currentTime >= seg.startTime && currentTime < seg.endTime
      );
      
      if (currentSegment && videoRef.current) {
        const relativeTime = currentTime - currentSegment.startTime;
        videoRef.current.currentTime = Math.max(0, relativeTime);
      }
      
      audioRef.current.play().catch(error => {
        console.error('Error playing audio:', error);
        toast.error('Error playing audio');
      });
    }
    setIsPlaying(!isPlaying);
  };

  // Debounced video seeking for better performance
  const debouncedSeek = (video: HTMLVideoElement, time: number) => {
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
    }
    
    seekTimeoutRef.current = setTimeout(() => {
      if (video && !video.seeking) {
        video.currentTime = Math.max(0, time);
      }
    }, 50); // 50ms debounce
  };

  // Video upload handling with optimizations
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setLoading(true);
    try {
      for (const file of acceptedFiles) {
        if (file.type.startsWith('video/')) {
          const clipId = generateUniqueId();
          
          // Get metadata for the video
          const metadata = await getVideoMetadata(file);
          
          // Create optimized blob URL for preview
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
      hasAudioFile: !!audioFile,
      clips: clips.map(c => ({ id: c.id, name: c.name, duration: c.duration })),
      beatMarkers: sortedBeats.map(b => b.time)
    });

    if (clips.length === 0) {
      console.error('🎬 EXPORT: No clips available');
      toast.error('Please add some video clips first');
      return;
    }

    if (!audioFile) {
      console.error('🎬 EXPORT: No audio file available');
      toast.error('Please upload an audio file first');
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
      console.log('🎬 EXPORT: Preparing videos and audio for processing');
      
      // Prepare videos for server processing
      const videosForProcessing = clips.map(clip => ({
        file: clip.file,
        id: clip.id
      }));

      const beatMarkers = sortedBeats.map(beat => beat.time);

      console.log('🎬 EXPORT: Calling processVideoWithBeats', {
        videosCount: videosForProcessing.length,
        beatMarkersCount: beatMarkers.length,
        audioFileName: audioFile.name,
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
        audioFile,
        `Rhythm Cut Export - ${new Date().toISOString()}`,
        exportQuality,
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
          {/* Simplified single video preview */}
          {currentVideoClip ? (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={currentVideoClip.url}
                className="w-full h-full"
                controls={false}
                muted={true}
                playsInline
                preload="metadata"
                poster=""
                onLoadStart={() => console.log('Video loading...')}
                onCanPlay={() => console.log('Video ready to play')}
                onError={(e) => console.error('Video error:', e)}
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
                    {currentTime.toFixed(1)}s
                  </span>
                </div>
              </div>

              {/* Loading indicator during transitions */}
              {isTransitioning && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-[#06B6D4] border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
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
                  <span className="text-gray-800 font-mono font-semibold">{beat.time.toFixed(2)}s</span>
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
            
            {/* Quality Selector */}
            <div className="mb-4">
              <label className="text-sm text-gray-600 block mb-2">Export Quality:</label>
              <select
                value={exportQuality}
                onChange={(e) => setExportQuality(e.target.value as 'fast' | 'balanced' | 'high')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                disabled={isProcessing}
              >
                <option value="fast">Fast (720p, Quick Processing)</option>
                <option value="balanced">Balanced (720p, Recommended)</option>
                <option value="high">High Quality (1080p, Best Output)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {exportQuality === 'fast' && '⚡ Faster processing with good quality'}
                {exportQuality === 'balanced' && '✨ Best balance of speed and quality'}
                {exportQuality === 'high' && '🎬 Maximum quality for professional output'}
              </p>
            </div>
            
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
              <div className="space-y-3">
                <button
                  onClick={handleExport}
                  disabled={clips.length === 0 || sortedBeats.length < 2 || !audioFile}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#06B6D4] text-white rounded-lg hover:bg-[#0891B2] disabled:opacity-50 disabled:hover:bg-[#06B6D4]"
                >
                  <Download size={20} />
                  Export Video with Audio
                </button>
                
                {(clips.length === 0 || sortedBeats.length < 2 || !audioFile) && (
                  <p className="text-xs text-gray-500">
                    {!audioFile && 'Upload an audio file, '}
                    {clips.length === 0 && 'add video clips, '}
                    {sortedBeats.length < 2 && 'add beat markers '}
                    to enable export
                  </p>
                )}
              </div>
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