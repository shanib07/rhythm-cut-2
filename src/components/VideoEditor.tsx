import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { Play, Pause, Plus, Trash2, Music, Video, Loader2, Upload, Clock, Download, X } from 'lucide-react';
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
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
    setIsPreviewMode(true);
    setIsProcessing(true);
    try {
      // Create a preview of the edited video
      const response = await fetch('/api/preview', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Preview',
          inputVideos: clips.map(clip => ({
            id: clip.id,
            url: clip.url,
            duration: clip.duration
          })),
          beatMarkers: sortedBeats.map(beat => beat.time)
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (data.success && data.jobId) {
        // Poll for job completion
        const checkJobStatus = async () => {
          const statusResponse = await fetch(`/api/status/${data.jobId}`);
          const statusData = await statusResponse.json();

          if (statusData.state === 'completed') {
            // For preview, we need to get the URL from the server
            const previewResponse = await fetch(`/api/preview-url/${data.jobId}`);
            const blob = await previewResponse.blob();
            const url = URL.createObjectURL(blob);
            setPreviewUrl(url);
            setIsProcessing(false);
          } else if (statusData.state === 'failed') {
            throw new Error('Preview generation failed');
          } else {
            // Continue polling
            setTimeout(checkJobStatus, 1000);
          }
        };

        // Start polling
        checkJobStatus();
      } else {
        throw new Error(data.error || 'Preview generation failed');
      }
    } catch (error) {
      console.error('Preview failed:', error);
      toast.error('Failed to generate preview');
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Export',
          inputVideos: clips.map(clip => ({
            id: clip.id,
            url: clip.url,
            duration: clip.duration
          })),
          beatMarkers: sortedBeats.map(beat => beat.time)
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (data.success && data.projectId) {
        // Poll for project completion
        const checkProjectStatus = async () => {
          const project = await fetch(`/api/project/${data.projectId}`);
          const projectData = await project.json();

          if (projectData.status === 'completed' && projectData.outputUrl) {
            setExportUrl(projectData.outputUrl);
            toast.success('Video exported successfully!');
            setIsProcessing(false);
          } else if (projectData.status === 'error') {
            throw new Error('Export failed');
          } else {
            // Continue polling
            setTimeout(checkProjectStatus, 1000);
          }
        };

        // Start polling
        checkProjectStatus();
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export video');
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6 p-6 bg-gradient-to-b from-navy-900 to-blue-950 rounded-lg shadow-lg">
      {/* Hidden canvas for video export */}
      <canvas 
        ref={canvasRef}
        className="hidden"
        style={{ position: 'absolute', left: '-9999px' }}
      />
      
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
                muted={true}
                onTimeUpdate={handleAudioTimeUpdate}
                onEnded={handleAudioEnded}
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
                  </div>
                  <button
                    onClick={() => removeClip(clip.id)}
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
          {/* Export button */}
          <button
            onClick={exportVideo}
            disabled={isExporting || !clips.length || !beats.length}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
              ${isExporting || !clips.length || !beats.length
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-[#06B6D4] text-white hover:bg-[#0891B2]'
              }`}
          >
            {isExporting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Export Video
              </>
            )}
          </button>

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
                <div
                  key={beat.id}
                  className="flex items-center justify-between bg-white p-2 rounded-lg border border-gray-200"
                >
                  <span className="text-black" style={{ color: 'black' }}>{beat.time.toFixed(2)}s</span>
                  {beat.id !== 'start' && (
                    <button
                      onClick={() => removeBeat(beat.id)}
                      className="p-1 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Current Segment Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-black font-semibold mb-3" style={{ color: 'black' }}>Current Segment Info</h3>
            {videoSegments.map((segment, index) => {
              const clip = clips.find(c => c.id === segment?.clipId);
              if (!segment || !clip) return null;

              return (
                <div key={index} className="mb-4 bg-white p-3 rounded-lg border border-gray-200">
                  <h4 className="text-black font-medium mb-2" style={{ color: 'black' }}>Video {index + 1}</h4>
                  <div className="space-y-1">
                    <p className="text-black" style={{ color: 'black' }}>Start: {segment.startTime.toFixed(2)}s</p>
                    <p className="text-black" style={{ color: 'black' }}>End: {segment.endTime.toFixed(2)}s</p>
                    <p className="text-black" style={{ color: 'black' }}>Duration: {(segment.endTime - segment.startTime).toFixed(2)}s</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timeline */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-black font-semibold mb-3" style={{ color: 'black' }}>Timeline</h3>
            <div className="relative h-20 bg-white rounded-lg border border-gray-200">
              {videoSegments.map((segment, index) => {
                if (!segment) return null;
                const totalDuration = sortedBeats[sortedBeats.length - 1]?.time || 1;
                const width = ((segment.endTime - segment.startTime) / totalDuration) * 100;
                const left = (segment.startTime / totalDuration) * 100;

                return (
                  <div
                    key={index}
                    className="absolute h-full bg-[#E5F7FA] border-r border-[#06B6D4] flex items-center justify-center"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`
                    }}
                  >
                    <span className="text-black text-sm" style={{ color: 'black' }}>{index + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-8 z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-4xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-900">Preview</h3>
              <button
                onClick={() => {
                  setPreviewUrl(null);
                  setIsPreviewMode(false);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>
            <video
              src={previewUrl}
              controls
              className="w-full rounded-lg"
              autoPlay
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4 mt-6">
        <button
          onClick={handlePreview}
          disabled={isProcessing || clips.length === 0 || sortedBeats.length === 0}
          className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg
            ${isProcessing || clips.length === 0 || sortedBeats.length === 0
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
        >
          {isProcessing && isPreviewMode ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Generating Preview...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Preview
            </>
          )}
        </button>

        <button
          onClick={handleExport}
          disabled={isProcessing || clips.length === 0 || sortedBeats.length === 0}
          className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg
            ${isProcessing || clips.length === 0 || sortedBeats.length === 0
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-green-500 text-white hover:bg-green-600'
            }`}
        >
          {isProcessing && !isPreviewMode ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              Export
            </>
          )}
        </button>
      </div>

      {/* Export URL */}
      {exportUrl && (
        <div className="mt-4 p-4 bg-white/10 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-green-400">Export complete!</span>
            <a
              href={exportUrl}
              download
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
            >
              <Download className="w-4 h-4" />
              Download Video
            </a>
          </div>
        </div>
      )}
    </div>
  );
}; 