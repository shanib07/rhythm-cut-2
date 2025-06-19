import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Play, Pause, Plus, Trash2, Music, Video, Loader2, Upload, Clock, Download } from 'lucide-react';
import { useVideoStore } from '../stores/videoStore';
import { generateUniqueId } from '../utils/videoUtils';
import { VideoClip, BeatMarker } from '../types';
import { toast } from 'sonner';
import { FFmpegVideoProcessor, VideoSegment, ProcessingProgress } from '../services/FFmpegVideoProcessor';

export const FFmpegVideoEditor: React.FC = () => {
  const {
    clips = [],
    beats = [],
    currentClip,
    isLoading,
    audioUrl,
    audioFile,
    addClip,
    removeClip,
    addBeat,
    removeBeat,
    setCurrentClip,
    setLoading
  } = useVideoStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [newBeatTime, setNewBeatTime] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const processorRef = useRef<FFmpegVideoProcessor | null>(null);

  // Sort beats and add 0 if not present
  const sortedBeats = useMemo(() => {
    const allBeats = beats.some(b => b.time === 0) 
      ? [...beats] 
      : [{ id: 'start', time: 0 }, ...beats];
    return allBeats.sort((a, b) => a.time - b.time);
  }, [beats]);

  // Calculate video segments based on beats and clips
  const videoSegments = useMemo((): VideoSegment[] => {
    if (!clips.length || !sortedBeats.length) return [];

    return clips.map((clip, index) => {
      const startBeat = sortedBeats[index];
      const endBeat = sortedBeats[index + 1];
      
      if (!startBeat) return null;

      return {
        id: clip.id,
        startTime: startBeat.time,
        endTime: endBeat ? endBeat.time : startBeat.time + clip.duration,
        videoFile: clip.file,
        videoStartTime: 0,
        videoEndTime: endBeat ? endBeat.time - startBeat.time : clip.duration
      };
    }).filter((segment): segment is VideoSegment => segment !== null);
  }, [clips, sortedBeats]);

  // Initialize FFmpeg processor
  useEffect(() => {
    if (!processorRef.current) {
      processorRef.current = new FFmpegVideoProcessor();
      processorRef.current.setProgressCallback(setProcessingProgress);
    }

    return () => {
      if (processorRef.current) {
        processorRef.current.dispose();
      }
    };
  }, []);

  // Initialize audio element for playback
  useEffect(() => {
    if (audioUrl && !audioRef.current) {
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

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  const handlePlayPause = () => {
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
      audioRef.current.play().catch(error => {
        console.error('Error playing audio:', error);
        toast.error('Error playing audio');
      });
      
      if (videoRef.current) {
        videoRef.current.play().catch(console.error);
      }
    }
    setIsPlaying(!isPlaying);
  };

  const createPreview = async () => {
    if (!processorRef.current || !audioFile || videoSegments.length === 0) {
      toast.error('Please upload audio and videos first');
      return;
    }

    setIsProcessing(true);
    try {
      // Set up FFmpeg processor
      await processorRef.current.setAudioFile(audioFile);
      
      // Add video files
      for (const segment of videoSegments) {
        await processorRef.current.addVideoFile(segment.id, segment.videoFile);
      }

      // Create preview
      await processorRef.current.createPreviewVideo(videoSegments, 30);
      const url = await processorRef.current.getPreviewUrl();
      setPreviewUrl(url);
      
      toast.success('Preview created successfully!');
    } catch (error) {
      console.error('Error creating preview:', error);
      toast.error('Failed to create preview');
    } finally {
      setIsProcessing(false);
    }
  };

  const exportVideo = async () => {
    if (!processorRef.current || !audioFile || videoSegments.length === 0) {
      toast.error('Please upload audio and videos first');
      return;
    }

    setIsExporting(true);
    try {
      // Set up FFmpeg processor
      await processorRef.current.setAudioFile(audioFile);
      
      // Add video files
      for (const segment of videoSegments) {
        await processorRef.current.addVideoFile(segment.id, segment.videoFile);
      }

      // Export video
      const blob = await processorRef.current.exportVideo(videoSegments);
      
      // Download the result
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited-video.mp4';
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success('Video exported successfully!');
    } catch (error) {
      console.error('Error exporting video:', error);
      toast.error('Failed to export video');
    } finally {
      setIsExporting(false);
    }
  };

  // Video upload handling
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setLoading(true);
    try {
      for (const file of acceptedFiles) {
        if (file.type.startsWith('video/')) {
          const clipId = generateUniqueId();
          const url = URL.createObjectURL(file);
          
          const video = document.createElement('video');
          video.src = url;
          
          await new Promise((resolve) => {
            video.onloadedmetadata = () => {
              const newClip: VideoClip = {
                id: clipId,
                file,
                url,
                duration: video.duration,
                name: file.name
              };
              addClip(newClip);
              
              if (clips.length === 0) {
                setCurrentClip(clipId);
              }

              resolve(null);
            };
          });
        }
      }
    } catch (error) {
      console.error('Error loading videos:', error);
      toast.error('Error loading videos');
    } finally {
      setLoading(false);
    }
  }, [addClip, setCurrentClip, clips.length, setLoading]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
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
      setNewBeatTime('');
      toast.success('Beat marker added');
    } catch (error) {
      toast.error('Invalid time format');
    }
  }, [newBeatTime, addBeat, beats]);

  const currentVideoClip = currentClip ? clips.find(c => c.id === currentClip) : null;

  return (
    <div className="flex flex-col h-full gap-6 p-6 bg-white rounded-lg shadow-lg">
      {/* Processing Progress */}
      {processingProgress && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-blue-800 font-medium">{processingProgress.stage}</span>
            <span className="text-blue-600">{Math.round(processingProgress.progress * 100)}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${processingProgress.progress * 100}%` }}
            />
          </div>
          {processingProgress.message && (
            <p className="text-blue-700 text-sm mt-2">{processingProgress.message}</p>
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left panel - Video upload and preview */}
        <div className="col-span-8 space-y-4">
          {/* Preview Video */}
          {previewUrl ? (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={previewUrl}
                className="w-full h-full"
                controls={false}
                muted={false}
              />
              
              {/* Playback controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/50 to-transparent">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handlePlayPause}
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
                  </>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4">
            <button
              onClick={createPreview}
              disabled={isProcessing || !audioFile || videoSegments.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-[#06B6D4] text-white rounded-md hover:bg-[#0891B2] transition-colors disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              {isProcessing ? 'Creating Preview...' : 'Create Preview'}
            </button>

            <button
              onClick={exportVideo}
              disabled={isExporting || !audioFile || videoSegments.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              {isExporting ? 'Exporting...' : 'Export Video'}
            </button>
          </div>

          {/* Video Clips List */}
          {clips.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-black font-semibold mb-3">Video Clips</h3>
              <div className="space-y-2">
                {clips.map((clip, index) => (
                  <div key={clip.id} className="flex items-center justify-between bg-white p-3 rounded-lg border">
                    <div>
                      <p className="text-black font-medium">{clip.name}</p>
                      <p className="text-gray-600 text-sm">Duration: {clip.duration.toFixed(2)}s</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-black text-sm">#{index + 1}</span>
                      <button
                        onClick={() => removeClip(clip.id)}
                        className="p-1 text-red-600 hover:text-red-800"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Beat management */}
        <div className="col-span-4 space-y-4">
          {/* Beat Markers */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-black font-semibold mb-3">Beat Markers</h3>
            
            {/* Add Beat */}
            <div className="flex gap-2 mb-4">
              <input
                type="number"
                step="0.1"
                value={newBeatTime}
                onChange={(e) => setNewBeatTime(e.target.value)}
                placeholder="Time (seconds)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-black"
              />
              <button
                onClick={handleAddBeat}
                className="p-2 bg-[#06B6D4] text-white rounded-md hover:bg-[#0891B2]"
              >
                <Plus size={20} />
              </button>
            </div>

            {/* Beat List */}
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {sortedBeats.map((beat) => (
                <div key={beat.id} className="flex items-center justify-between bg-white p-2 rounded border">
                  <span className="text-black">{beat.time.toFixed(2)}s</span>
                  {beat.id !== 'start' && (
                    <button
                      onClick={() => removeBeat(beat.id)}
                      className="p-1 text-red-600 hover:text-red-800"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          {videoSegments.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-black font-semibold mb-3">Timeline</h3>
              <div className="space-y-2">
                {videoSegments.map((segment, index) => (
                  <div key={segment.id} className="bg-white p-3 rounded-lg border border-gray-200">
                    <h4 className="text-black font-medium mb-2">Segment {index + 1}</h4>
                    <div className="space-y-1 text-sm">
                      <p className="text-black">Start: {segment.startTime.toFixed(2)}s</p>
                      <p className="text-black">End: {segment.endTime.toFixed(2)}s</p>
                      <p className="text-black">Duration: {(segment.endTime - segment.startTime).toFixed(2)}s</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}; 