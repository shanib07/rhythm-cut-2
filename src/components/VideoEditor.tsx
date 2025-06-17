import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Play, Pause, Plus, Trash2, Music, Video, Loader2, Upload, Clock, Download } from 'lucide-react';
import { useVideoStore } from '../stores/videoStore';
import { generateUniqueId } from '../utils/videoUtils';
import { VideoClip, BeatMarker, TimelineSegment } from '../types';
import { toast } from 'sonner';

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
    addTimelineSegment,
    removeTimelineSegment,
    setCurrentClip,
    setLoading
  } = useVideoStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [newBeatTime, setNewBeatTime] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

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

  // Handle video playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(console.error);
    } else {
      video.pause();
    }
  }, [isPlaying, currentVideoIndex]);

  // Handle video switching based on current time
  useEffect(() => {
    if (!isPlaying || clips.length === 0 || sortedBeats.length === 0) return;

    const checkAndSwitchVideo = () => {
      if (!videoRef.current) return;

      // Find the current segment
      const currentSegment = videoSegments.find(segment => 
        segment && currentTime >= segment.startTime && currentTime < segment.endTime
      );

      if (currentSegment) {
        const segmentIndex = clips.findIndex(clip => clip.id === currentSegment.clipId);
        
        if (segmentIndex !== currentVideoIndex) {
          setCurrentVideoIndex(segmentIndex);
          setCurrentClip(currentSegment.clipId);
          
          // Set the correct time within the video
          if (videoRef.current) {
            const relativeTime = currentTime - currentSegment.startTime;
            videoRef.current.currentTime = relativeTime;
          }
        }
      }
    };

    const timer = setInterval(checkAndSwitchVideo, 50);
    return () => clearInterval(timer);
  }, [currentTime, isPlaying, clips, videoSegments, currentVideoIndex, setCurrentClip]);

  // Handle video time update
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const currentSegment = videoSegments[currentVideoIndex];
    
    if (currentSegment) {
      const relativeTime = video.currentTime;
      const absoluteTime = currentSegment.startTime + relativeTime;
      
      // If we've reached the end of this segment, switch to next video
      if (absoluteTime >= currentSegment.endTime) {
        const nextIndex = currentVideoIndex + 1;
        if (nextIndex < clips.length) {
          setCurrentVideoIndex(nextIndex);
          setCurrentClip(clips[nextIndex].id);
          if (videoRef.current) {
            videoRef.current.currentTime = 0;
          }
        } else {
          setIsPlaying(false);
          setCurrentTime(0);
          setCurrentVideoIndex(0);
          if (clips[0]) {
            setCurrentClip(clips[0].id);
          }
        }
      } else {
        setCurrentTime(absoluteTime);
      }
    }
  };

  // Handle video ended
  const handleVideoEnded = () => {
    const nextIndex = currentVideoIndex + 1;
    if (nextIndex < clips.length) {
      setCurrentVideoIndex(nextIndex);
      setCurrentClip(clips[nextIndex].id);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
    } else {
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentVideoIndex(0);
      if (clips[0]) {
        setCurrentClip(clips[0].id);
      }
    }
  };

  // Handle play/pause
  const togglePlay = () => {
    if (!isPlaying) {
      // If starting playback, ensure we're at the right position
      const currentSegment = videoSegments[currentVideoIndex];
      if (currentSegment && videoRef.current) {
        const relativeTime = currentTime - currentSegment.startTime;
        videoRef.current.currentTime = relativeTime;
      }
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
                setCurrentVideoIndex(0);
              }

              resolve(null);
            };
          });
        }
      }
    } catch (error) {
      console.error('Error loading videos:', error);
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

    setIsExporting(true);
    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        throw new Error('Canvas not available');
      }

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

      // Create MediaRecorder with high quality settings
      const stream = canvas.captureStream(60); // Increase to 60 FPS
      
      // Try different codecs in order of preference
      const mimeTypes = [
        'video/mp4;codecs=h264',
        'video/webm;codecs=h264',
        'video/webm;codecs=vp9',
        'video/webm'
      ];
      
      let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
      if (!selectedMimeType) {
        throw new Error('No supported video codec found');
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 8000000 // 8 Mbps for better quality
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

        // If we're using MP4, we need to process it first
        if (selectedMimeType.includes('mp4')) {
          try {
            // Convert to MP4 using MediaRecorder's data
            const arrayBuffer = await blob.arrayBuffer();
            const file = new File([arrayBuffer], 'temp.mp4', { type: 'video/mp4' });
            
            // Create download link
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'edited-video.mp4';
            a.click();
            URL.revokeObjectURL(url);
          } catch (error) {
            console.error('Error processing MP4:', error);
            // Fallback to WebM if MP4 processing fails
            const webmBlob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(webmBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'edited-video.webm';
            a.click();
            URL.revokeObjectURL(url);
          }
        } else {
          // WebM format
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'edited-video.webm';
          a.click();
          URL.revokeObjectURL(url);
        }
        
        setIsExporting(false);
        toast.success('Video export completed!');
      };

      // Start recording with smaller timeslice for more frequent ondataavailable events
      mediaRecorder.start(1000);

      // Process each segment with precise timing
      for (const segment of videoSegments) {
        if (!segment) continue;

        const clip = clips.find(c => c.id === segment.clipId);
        if (!clip) continue;

        const video = document.createElement('video');
        video.src = clip.url;
        
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

            video.play();
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

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      {/* Main content area */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left panel - Video upload and preview */}
        <div className="col-span-8 space-y-4">
          {/* Video preview */}
          {currentVideoClip ? (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={currentVideoClip.url}
                className="w-full h-full"
                controls={false}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleVideoEnded}
              />
              
              {/* Playback controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/50 to-transparent">
                <div className="flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    className="p-2 rounded-full bg-white/90 hover:bg-white"
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <div className="flex-1">
                    <div className="h-1 bg-white/30 rounded-full">
                      <div
                        className="h-full bg-white rounded-full"
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
                ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'}`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="w-12 h-12 text-gray-400 animate-spin" />
                    <p className="text-gray-600">Loading videos...</p>
                  </>
                ) : (
                  <>
                    <Video className="w-12 h-12 text-gray-400" />
                    <p className="text-gray-600">
                      {isDragActive
                        ? 'Drop the videos here...'
                        : 'Drag & drop videos, or click to select'}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Clips and beats */}
        <div className="col-span-4 space-y-4">
          {/* Export button */}
          <button
            onClick={exportVideo}
            disabled={isExporting || !clips.length || !beats.length}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
              ${isExporting || !clips.length || !beats.length
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600'
              }`}
          >
            {isExporting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                <span>Export Video</span>
              </>
            )}
          </button>

          {/* Upload more videos button */}
          <div
            {...getRootProps()}
            className="bg-blue-50 border-2 border-dashed border-blue-200 rounded-lg p-4 text-center cursor-pointer hover:bg-blue-100 transition-colors"
          >
            <input {...getInputProps()} />
            <Upload className="w-6 h-6 text-blue-500 mx-auto mb-2" />
            <p className="text-blue-600 text-sm">Upload more videos</p>
          </div>

          {/* Clips list */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold mb-3">Video Clips</h3>
            <div className="space-y-2">
              {clips?.map((clip, index) => (
                <div
                  key={clip.id}
                  onClick={() => setCurrentClip(clip.id)}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer
                    ${clip.id === currentClip ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50'}`}
                >
                  <Video size={16} />
                  <span className="flex-1 truncate">
                    {index + 1}. {clip.name}
                  </span>
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
            </div>
          </div>

          {/* Beat markers */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold mb-3">Beat Markers (in seconds)</h3>
            <div className="flex gap-2 mb-4">
              <input
                type="number"
                value={newBeatTime}
                onChange={(e) => setNewBeatTime(e.target.value)}
                placeholder="Time in seconds (e.g., 1.5)"
                step="0.1"
                min="0"
                className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleAddBeat}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Add Beat
              </button>
            </div>
            <div className="space-y-2">
              {beats?.map((beat, index) => (
                <div
                  key={beat.id}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded"
                >
                  <div className="flex items-center gap-2">
                    <Clock size={16} />
                    <span>{beat.time.toFixed(2)}s</span>
                  </div>
                  <button
                    onClick={() => removeBeat(beat.id)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Debug info */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold mb-3">Current Segment Info</h3>
            <div className="text-sm space-y-1">
              {videoSegments.map((segment, index) => segment && (
                <div key={index} className={`p-2 rounded ${index === currentVideoIndex ? 'bg-blue-50' : 'bg-gray-50'}`}>
                  <div>Video {index + 1}</div>
                  <div>Start: {segment.startTime}s</div>
                  <div>End: {segment.endTime}s</div>
                  <div>Duration: {(segment.endTime - segment.startTime).toFixed(2)}s</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-4">Timeline</h3>
        <div className="relative h-32 bg-gray-50 rounded border border-gray-200">
          {/* Beat markers */}
          {sortedBeats?.map((beat, index) => (
            <div
              key={beat.id}
              className="absolute top-0 bottom-0 w-px bg-gray-300"
              style={{ left: `${(beat.time / Math.max(...sortedBeats.map(b => b.time), 1)) * 100}%` }}
            >
              <div className="absolute top-0 -translate-x-1/2 px-1 py-0.5 text-xs bg-gray-100 rounded">
                {index === 0 ? '0:00' : beat.time.toFixed(2)}s
              </div>
            </div>
          ))}

          {/* Timeline segments */}
          {timeline?.map((segment, index) => {
            const clip = clips.find(c => c.id === segment.clipId);
            if (!clip) return null;

            const totalDuration = Math.max(...sortedBeats.map(b => b.time), 1);
            const left = (segment.beatStart / totalDuration) * 100;
            const width = ((segment.beatEnd - segment.beatStart) / totalDuration) * 100;

            return (
              <motion.div
                key={segment.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute h-16 top-8 bg-blue-100 rounded cursor-pointer hover:bg-blue-200"
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => removeTimelineSegment(segment.id)}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs text-blue-600 truncate px-2">
                    Video {index + 1}: {clip.name}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Help text */}
      <div className="text-sm text-gray-500 mt-4">
        <p>How to use:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Upload videos in the order you want them to play</li>
          <li>Add beat markers to specify when to switch videos (e.g., 1, 4, 10 seconds)</li>
          <li>Videos will automatically play in sequence between beat markers</li>
          <li>Click on timeline segments to remove them</li>
        </ol>
      </div>

      {/* Hidden canvas for video processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}; 