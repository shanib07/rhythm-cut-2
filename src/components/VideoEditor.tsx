import React, { useCallback, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Plus, Trash2, Music, Video, Loader2 } from 'lucide-react';
import { useVideoStore } from '../stores/videoStore';
import { generateUniqueId } from '../utils/videoUtils';
import { VideoClip, BeatMarker, TimelineSegment } from '../types';

export const VideoEditor: React.FC = () => {
  const {
    clips = [],
    beats = [],
    timeline = [],
    currentClip,
    isLoading,
    addClip,
    removeClip,
    addBeat,
    removeBeat,
    updateBeat,
    addTimelineSegment,
    removeTimelineSegment,
    setCurrentClip,
    setLoading
  } = useVideoStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [draggedClip, setDraggedClip] = useState<string | null>(null);

  // Video upload handling
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.type.startsWith('video/')) {
      setLoading(true);
      try {
        const clipId = generateUniqueId();
        const url = URL.createObjectURL(file);
        
        // Create video element to get duration
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
            setCurrentClip(clipId);
            resolve(null);
          };
        });
      } catch (error) {
        console.error('Error loading video:', error);
      } finally {
        setLoading(false);
      }
    }
  }, [addClip, setCurrentClip, setLoading]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    multiple: false
  });

  // Beat management
  const handleAddBeat = useCallback(() => {
    if (!currentClip) return;
    
    const newBeat: BeatMarker = {
      id: generateUniqueId(),
      time: currentTime
    };
    addBeat(newBeat);
  }, [currentTime, addBeat, currentClip]);

  // Timeline segment management
  const handleClipDrop = useCallback((beatStart: number, beatEnd: number) => {
    if (draggedClip && currentClip) {
      const clip = clips.find(c => c.id === draggedClip);
      if (!clip) return;

      const newSegment: TimelineSegment = {
        id: generateUniqueId(),
        clipId: draggedClip,
        beatStart,
        beatEnd,
        clipStartTime: 0,
        clipEndTime: clip.duration
      };
      addTimelineSegment(newSegment);
    }
    setDraggedClip(null);
  }, [draggedClip, currentClip, clips, addTimelineSegment]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleTogglePlayback = () => {
      if (currentClip) {
        setIsPlaying(!isPlaying);
      }
    };

    const handleAddBeatMarker = () => {
      if (currentClip) {
        handleAddBeat();
      }
    };

    document.addEventListener('togglePlayback', handleTogglePlayback);
    document.addEventListener('addBeatMarker', handleAddBeatMarker);

    return () => {
      document.removeEventListener('togglePlayback', handleTogglePlayback);
      document.removeEventListener('addBeatMarker', handleAddBeatMarker);
    };
  }, [currentClip, isPlaying, handleAddBeat]);

  // Update video playback when isPlaying changes
  useEffect(() => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
      if (isPlaying) {
        videoElement.play();
      } else {
        videoElement.pause();
      }
    }
  }, [isPlaying]);

  const currentVideoClip = currentClip ? clips.find(c => c.id === currentClip) : null;

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      {/* Main content area */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left panel - Video upload and preview */}
        <div className="col-span-8 space-y-4">
          {/* Video upload area */}
          {!currentClip && (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'}`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="w-12 h-12 text-gray-400 animate-spin" />
                    <p className="text-gray-600">Loading video...</p>
                  </>
                ) : (
                  <>
                    <Video className="w-12 h-12 text-gray-400" />
                    <p className="text-gray-600">
                      {isDragActive
                        ? 'Drop the video here...'
                        : 'Drag & drop a video, or click to select'}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Video preview */}
          {currentVideoClip && (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                src={currentVideoClip.url}
                className="w-full h-full"
                controls={false}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              />
              
              {/* Playback controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/50 to-transparent">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="p-2 rounded-full bg-white/90 hover:bg-white"
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <div className="flex-1">
                    <div className="h-1 bg-white/30 rounded-full">
                      <div
                        className="h-full bg-white rounded-full"
                        style={{ width: `${(currentTime / (currentVideoClip.duration || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Clips and beats */}
        <div className="col-span-4 space-y-4">
          {/* Clips list */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold mb-3">Video Clips</h3>
            <div className="space-y-2">
              {clips?.map(clip => (
                <div
                  key={clip.id}
                  draggable
                  onDragStart={() => setDraggedClip(clip.id)}
                  onClick={() => setCurrentClip(clip.id)}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer
                    ${clip.id === currentClip ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50'}`}
                >
                  <Video size={16} />
                  <span className="flex-1 truncate">{clip.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeClip(clip.id);
                    }}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {clips.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-2">
                  No clips added yet
                </p>
              )}
            </div>
          </div>

          {/* Beats list */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Beat Markers</h3>
              <button
                onClick={handleAddBeat}
                className="p-1 hover:bg-gray-100 rounded"
                disabled={!currentClip}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="space-y-2">
              {beats?.map(beat => (
                <div
                  key={beat.id}
                  className="flex items-center gap-2 p-2 bg-gray-50 rounded"
                >
                  <Music size={16} />
                  <span className="flex-1">{beat.time.toFixed(2)}s</span>
                  <button
                    onClick={() => removeBeat(beat.id)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {beats.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-2">
                  No beat markers added
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-4">Timeline</h3>
        <div className="relative h-32 bg-gray-50 rounded border border-gray-200">
          {/* Beat markers */}
          {beats?.map((beat, index) => (
            <div
              key={beat.id}
              className="absolute top-0 bottom-0 w-px bg-gray-300"
              style={{ left: `${(beat.time / (currentVideoClip?.duration || 1)) * 100}%` }}
            >
              <div className="absolute top-0 -translate-x-1/2 px-1 py-0.5 text-xs bg-gray-100 rounded">
                {index + 1}
              </div>
            </div>
          ))}

          {/* Timeline segments */}
          {timeline?.map(segment => {
            const clip = clips.find(c => c.id === segment.clipId);
            if (!clip) return null;

            const startBeat = beats.find(b => b.time === segment.beatStart);
            const endBeat = beats.find(b => b.time === segment.beatEnd);
            if (!startBeat || !endBeat) return null;

            const left = (startBeat.time / (currentVideoClip?.duration || 1)) * 100;
            const width = ((endBeat.time - startBeat.time) / (currentVideoClip?.duration || 1)) * 100;

            return (
              <div
                key={segment.id}
                className="absolute h-16 top-8 bg-blue-100 rounded cursor-pointer hover:bg-blue-200"
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => removeTimelineSegment(segment.id)}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs text-blue-600 truncate px-2">
                    {clip.name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}; 