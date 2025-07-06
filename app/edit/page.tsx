'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Loader2, Play, Pause, Download, Edit2, Plus, FileAudio, Settings, Sparkles, Film, ChevronLeft, ChevronRight } from 'lucide-react';
import { AudioAnalyzer } from '@/src/services/AudioAnalyzer';
import { toast } from 'sonner';
import { useVideoStore } from '@/src/stores/videoStore';
import { generateUniqueId } from '@/src/utils/videoUtils';
import { processVideoWithBeatsDirect } from '@/src/utils/ffmpeg';
import { FilmstripEditor } from '@/src/components/FilmstripEditor';

interface Beat {
  id: string;
  time: number;
  duration: number;
  videoClip?: {
    id: string;
    file: File;
    url: string;
    name: string;
    thumbnailUrl?: string;
    startTime?: number;
  };
}

export default function EditPage() {
  // State Management
  const [currentStep, setCurrentStep] = useState<'audio' | 'video' | 'export'>('audio');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [selectedBeatIndex, setSelectedBeatIndex] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [exportQuality, setExportQuality] = useState<'720p' | '1080p' | '4K'>('1080p');
  const [hoveredBeatIndex, setHoveredBeatIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [editingBeatIndex, setEditingBeatIndex] = useState<number | null>(null);
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Refs
  const audioFileRef = useRef<File | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Video Store
  const { 
    setAudioFile,
    setAudioUrl,
    setAudioBuffer,
    audioFile,
    audioUrl,
    audioBuffer
  } = useVideoStore();

  // Initialize Audio Analyzer
  useEffect(() => {
    analyzerRef.current = new AudioAnalyzer({
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      sensitivity: 1.0
    });
    
    // Set algorithm separately if the method exists
    if (analyzerRef.current && typeof analyzerRef.current.setAlgorithm === 'function') {
      analyzerRef.current.setAlgorithm('onset');
    }

    return () => {
      analyzerRef.current?.dispose();
    };
  }, []);

  // Audio time update handler
  useEffect(() => {
    if (audioRef.current) {
      const handleTimeUpdate = () => {
        setCurrentTime(audioRef.current!.currentTime);
      };
      
      const handleLoadedMetadata = () => {
        setDuration(audioRef.current!.duration);
      };

      audioRef.current.addEventListener('timeupdate', handleTimeUpdate);
      audioRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      return () => {
        audioRef.current?.removeEventListener('timeupdate', handleTimeUpdate);
        audioRef.current?.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    }
  }, [audioUrl]);

  // Audio Upload Handler
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsAnalyzing(true);
      audioFileRef.current = file;
      
      // Create audio URL
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setAudioFile(file);

      // Create audio element
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(url);

      // Decode audio
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);

      // Analyze beats
      if (analyzerRef.current) {
        const results = await analyzerRef.current.analyzeAudioBuffer(buffer);
        
        // Create beat objects with durations
        const beatObjects: Beat[] = [];
        for (let i = 0; i < results.beats.length; i++) {
          const currentBeat = results.beats[i];
          const nextBeat = results.beats[i + 1];
          const duration = nextBeat ? nextBeat.timestamp - currentBeat.timestamp : 2; // Default 2s for last beat
          
          beatObjects.push({
            id: generateUniqueId(),
            time: currentBeat.timestamp,
            duration: duration
          });
        }
        
        setBeats(beatObjects);
        toast.success(`Detected ${beatObjects.length} beats. Please upload ${beatObjects.length} video clips.`);
        setCurrentStep('video');
      }
    } catch (error) {
      console.error('Error analyzing audio:', error);
      toast.error('Failed to analyze audio file');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Video Upload Handler
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>, beatIndex?: number) => {
    const files = e.target.files;
    if (!files) return;

    const newBeats = [...beats];
    let currentIndex = beatIndex ?? beats.findIndex(b => !b.videoClip);

    for (const file of files) {
      if (currentIndex >= beats.length) break;
      
      const url = URL.createObjectURL(file);
      
      // Generate thumbnail and get duration
      const video = document.createElement('video');
      video.src = url;
      video.currentTime = 1; // Seek to 1 second for thumbnail
      
      await new Promise((resolve) => {
        video.onloadeddata = resolve;
      });

      // Store video duration
      const duration = video.duration;
      const videoId = generateUniqueId();
      
      setVideoDurations(prev => ({
        ...prev,
        [videoId]: duration
      }));

      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, 160, 90);
      const thumbnailUrl = canvas.toDataURL('image/jpeg');

      newBeats[currentIndex] = {
        ...newBeats[currentIndex],
        videoClip: {
          id: videoId,
          file,
          url,
          name: file.name,
          thumbnailUrl,
          startTime: 0
        }
      };
      
      currentIndex++;
    }

    setBeats(newBeats);
    
    // Check if all beats have videos
    const allBeatsHaveVideos = newBeats.every(beat => beat.videoClip);
    if (allBeatsHaveVideos) {
      toast.success('All beats have video clips assigned!');
      // Render preview automatically
      renderPreview();
    }
  };

  // Render preview for playback
  const renderPreview = async () => {
    if (!audioFileRef.current || beats.some(beat => !beat.videoClip)) return;
    
    setIsRenderingPreview(true);
    toast.info('Rendering preview...');
    
    try {
      // For now, we'll just use the first video as preview
      // In production, this should create a low-quality proxy render
      const firstBeat = beats[0];
      if (firstBeat?.videoClip) {
        setPreviewUrl(firstBeat.videoClip.url);
      }
    } catch (error) {
      console.error('Error rendering preview:', error);
      toast.error('Failed to render preview');
    } finally {
      setIsRenderingPreview(false);
    }
  };

  // Export Handler
  const handleExport = async () => {
    if (!audioFileRef.current || beats.some(beat => !beat.videoClip)) {
      toast.error('Please ensure all beats have video clips assigned');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportMessage('Preparing your masterpiece...');

    try {
      const videosForProcessing = beats.map(beat => ({
        file: beat.videoClip!.file,
        id: beat.videoClip!.id,
        startTime: beat.videoClip!.startTime || 0
      }));

      const beatMarkers = [0, ...beats.map(beat => beat.time)];
      
      // Map quality to FFmpeg settings - using 'balanced' as default
      const qualityMap = {
        '720p': 'fast',
        '1080p': 'balanced',
        '4K': 'high'
      };

      const messages = [
        'Uploading files to the cloud...',
        'Analyzing beat patterns...',
        'Synchronizing video clips...',
        'Applying transitions...',
        'Mixing audio tracks...',
        'Finalizing your video...'
      ];

      const outputUrl = await processVideoWithBeatsDirect(
        videosForProcessing,
        beatMarkers,
        audioFileRef.current,
        `Rhythm Cut Export - ${new Date().toISOString()}`,
        qualityMap[exportQuality] as 'fast' | 'balanced' | 'high',
        (progress) => {
          setExportProgress(Math.round(progress * 100));
          const messageIndex = Math.min(Math.floor(progress * messages.length), messages.length - 1);
          setExportMessage(messages[messageIndex]);
        }
      );

      // Trigger download
      const downloadLink = document.createElement('a');
      downloadLink.href = outputUrl;
      downloadLink.download = `rhythm-cut-${Date.now()}.mp4`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      toast.success('Video exported successfully!');
      setCurrentStep('export');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export video');
    } finally {
      setIsExporting(false);
    }
  };

  // Play/Pause Handler
  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      previewVideoRef.current?.pause();
    } else {
      audioRef.current.play();
      previewVideoRef.current?.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Timeline navigation
  const scrollTimeline = (direction: 'left' | 'right') => {
    if (!timelineRef.current) return;
    const scrollAmount = 200;
    timelineRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  // Format time helper
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white">
      <AnimatePresence mode="wait">
        {currentStep === 'audio' && (
          <motion.div
            key="audio"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex items-center justify-center min-h-screen p-8"
          >
            <div className="max-w-md w-full">
              {!isAnalyzing ? (
                <motion.div
                  className="relative group cursor-pointer"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity" />
                  
                  <label
                    htmlFor="audioInput"
                    className="relative block bg-gray-900/90 backdrop-blur-xl border border-gray-800 rounded-2xl p-12 text-center cursor-pointer overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-blue-500/10" />
                    
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", duration: 0.5 }}
                      className="relative z-10"
                    >
                      <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                        <FileAudio className="w-12 h-12" />
                      </div>
                      
                      <h2 className="text-2xl font-bold mb-2">Import Audio</h2>
                      <p className="text-gray-400">Click to upload your audio file</p>
                      <p className="text-sm text-gray-500 mt-2">Supported formats: MP3, WAV, M4A</p>
                    </motion.div>
                    
                    <input
                      ref={fileInputRef}
                      id="audioInput"
                      type="file"
                      accept="audio/*"
                      onChange={handleAudioUpload}
                      className="hidden"
                    />
                  </label>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-gray-900/90 backdrop-blur-xl border border-gray-800 rounded-2xl p-12 text-center"
                >
                  <div className="relative">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="w-24 h-24 mx-auto mb-6"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full blur-xl opacity-50" />
                      <div className="relative w-full h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                        <Sparkles className="w-12 h-12" />
                      </div>
                    </motion.div>
                  </div>
                  
                  <h2 className="text-2xl font-bold mb-2">Detecting Beats...</h2>
                  <p className="text-gray-400">Analyzing your audio file</p>
                  
                  <div className="mt-6 w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 3, ease: "easeInOut" }}
                      className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                    />
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {currentStep === 'video' && (
          <motion.div
            key="video"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col h-screen"
          >
            {/* Header */}
            <div className="px-6 py-3 border-b border-gray-800/50 backdrop-blur-xl bg-gray-900/50">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold">Video Editor</h1>
                
                <div className="flex items-center gap-3">
                  {/* Import Button */}
                  <label
                    htmlFor="video-bulk"
                    className="px-4 py-1.5 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors cursor-pointer flex items-center gap-2 text-sm"
                  >
                    <Upload className="w-4 h-4" />
                    Import Videos
                    <input
                      id="video-bulk"
                      ref={videoFileInputRef}
                      type="file"
                      accept="video/*"
                      multiple
                      onChange={handleVideoUpload}
                      className="hidden"
                    />
                  </label>

                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-1.5 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={handleExport}
                    disabled={beats.some(beat => !beat.videoClip) || isExporting}
                    className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-purple-500/25 transition-all"
                  >
                    <Download className="w-4 h-4 inline mr-1.5" />
                    Export
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col p-6 gap-4">
              {/* Preview Area */}
              <div className="flex-1 relative max-h-[50vh]">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-blue-500/10 rounded-xl" />
                <div className="relative h-full bg-gray-900/50 backdrop-blur-xl border border-gray-800/50 rounded-xl overflow-hidden">
                  {previewUrl || (selectedBeatIndex !== null && beats[selectedBeatIndex]?.videoClip) ? (
                    <video
                      ref={previewVideoRef}
                      src={previewUrl || beats[selectedBeatIndex!]?.videoClip?.url}
                      className="w-full h-full object-contain"
                      controls={false}
                      muted={!previewUrl}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="w-24 h-24 mx-auto mb-3 bg-gray-800/50 rounded-full flex items-center justify-center">
                          <Play className="w-12 h-12 text-gray-600" />
                        </div>
                        <p className="text-gray-400 text-sm">Upload videos to see preview</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Playback Controls */}
                  {(previewUrl || audioUrl) && (
                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={togglePlayback}
                          className="p-2 rounded-full bg-white/10 backdrop-blur-xl hover:bg-white/20 transition-colors"
                          disabled={!audioUrl}
                        >
                          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        </button>
                        
                        <div className="flex-1">
                          <div className="h-1 bg-white/20 rounded-full">
                            <div 
                              className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all" 
                              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} 
                            />
                          </div>
                        </div>
                        
                        <span className="text-xs font-mono">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {isRenderingPreview && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                        <p className="text-sm">Rendering preview...</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline */}
              <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Film className="w-4 h-4" />
                    Timeline
                  </h3>
                  <span className="text-xs text-gray-400">
                    {beats.filter(b => b.videoClip).length} / {beats.length} clips added
                  </span>
                </div>

                <div className="relative">
                  <button
                    onClick={() => scrollTimeline('left')}
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1.5 bg-gray-800/90 backdrop-blur rounded-full hover:bg-gray-700 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={() => scrollTimeline('right')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1.5 bg-gray-800/90 backdrop-blur rounded-full hover:bg-gray-700 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <div
                    ref={timelineRef}
                    className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-2 px-8"
                  >
                    {beats.map((beat, index) => (
                      <motion.div
                        key={beat.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="flex-shrink-0"
                        onMouseEnter={() => setHoveredBeatIndex(index)}
                        onMouseLeave={() => setHoveredBeatIndex(null)}
                        onClick={() => {
                          if (beat.videoClip) {
                            setSelectedBeatIndex(index);
                          }
                        }}
                      >
                        <div className={`relative w-32 h-20 rounded-lg overflow-hidden cursor-pointer transition-all ${
                          selectedBeatIndex === index ? 'ring-2 ring-purple-500' : ''
                        }`}>
                          {beat.videoClip ? (
                            <>
                              <img
                                src={beat.videoClip.thumbnailUrl || ''}
                                alt={beat.videoClip.name}
                                className="w-full h-full object-cover"
                              />
                              
                              {/* Hover Overlay */}
                              <AnimatePresence>
                                {hoveredBeatIndex === index && (
                                  <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 bg-black/60 flex items-center justify-center"
                                  >
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingBeatIndex(index);
                                      }}
                                      className="p-1.5 rounded-lg bg-white/20 backdrop-blur-xl hover:bg-white/30 transition-colors"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </>
                          ) : (
                            <label
                              htmlFor={`video-${index}`}
                              className="w-full h-full bg-gray-800/50 border-2 border-dashed border-gray-700 rounded-lg flex items-center justify-center cursor-pointer hover:bg-gray-700/50 transition-colors"
                            >
                              <Plus className="w-6 h-6 text-gray-500" />
                              <input
                                id={`video-${index}`}
                                type="file"
                                accept="video/*"
                                onChange={(e) => handleVideoUpload(e, index)}
                                className="hidden"
                              />
                            </label>
                          )}
                          
                          {/* Duration Label */}
                          <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/80 backdrop-blur-xl">
                            <p className="text-xs font-mono text-center">
                              {beat.duration.toFixed(1)}s
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Settings Panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ x: 300, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 300, opacity: 0 }}
                  className="absolute right-0 top-14 h-[calc(100%-3.5rem)] w-72 bg-gray-900/95 backdrop-blur-xl border-l border-gray-800/50 p-4"
                >
                  <h3 className="text-lg font-semibold mb-4">Export Settings</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">
                        Export Quality
                      </label>
                      <select
                        value={exportQuality}
                        onChange={(e) => setExportQuality(e.target.value as '720p' | '1080p' | '4K')}
                        className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-purple-500 transition-colors"
                      >
                        <option value="720p">720p (Fast)</option>
                        <option value="1080p">1080p (Balanced)</option>
                        <option value="4K">4K (High Quality)</option>
                      </select>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Filmstrip Editor Modal */}
            {editingBeatIndex !== null && beats[editingBeatIndex]?.videoClip && (
              <FilmstripEditor
                videoUrl={beats[editingBeatIndex].videoClip!.url}
                duration={videoDurations[beats[editingBeatIndex].videoClip!.id] || 10}
                beatDuration={beats[editingBeatIndex].duration}
                onSave={(startTime) => {
                  // Update the beat with the selected start time
                  const newBeats = [...beats];
                  if (newBeats[editingBeatIndex].videoClip) {
                    newBeats[editingBeatIndex] = {
                      ...newBeats[editingBeatIndex],
                      videoClip: {
                        ...newBeats[editingBeatIndex].videoClip!,
                        startTime
                      }
                    };
                  }
                  setBeats(newBeats);
                  setEditingBeatIndex(null);
                  toast.success('Video segment updated!');
                }}
                onClose={() => setEditingBeatIndex(null)}
              />
            )}
          </motion.div>
        )}

        {/* Export Screen */}
        {isExporting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center max-w-md"
            >
              {/* Animated Logo */}
              <div className="relative w-32 h-32 mx-auto mb-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full blur-xl opacity-50" />
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full" />
                </motion.div>
                
                <div className="absolute inset-0 flex items-center justify-center">
                  <Film className="w-16 h-16 text-white" />
                </div>
                
                {/* Progress Ring */}
                <svg className="absolute inset-0 -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="60"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="60"
                    stroke="url(#gradient)"
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 60}`}
                    strokeDashoffset={`${2 * Math.PI * 60 * (1 - exportProgress / 100)}`}
                    className="transition-all duration-500"
                  />
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#a855f7" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <h2 className="text-2xl font-bold mb-2">Exporting Your Video</h2>
              <p className="text-gray-400 mb-6">{exportMessage}</p>
              
              <div className="text-4xl font-bold bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">
                {exportProgress}%
              </div>
              
              <div className="mt-8 flex justify-center gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ scale: [1, 1.5, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                    className="w-3 h-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full"
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}

        {currentStep === 'export' && (
          <motion.div
            key="export"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-center min-h-screen p-8"
          >
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", duration: 0.5 }}
                className="w-32 h-32 mx-auto mb-6 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center"
              >
                <Download className="w-16 h-16" />
              </motion.div>
              
              <h2 className="text-3xl font-bold mb-2">Export Complete!</h2>
              <p className="text-gray-400 mb-6">Your video has been downloaded</p>
              
              <button
                onClick={() => {
                  setCurrentStep('audio');
                  setBeats([]);
                  setSelectedBeatIndex(null);
                }}
                className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-lg font-medium hover:shadow-lg hover:shadow-purple-500/25 transition-all"
              >
                Create Another Video
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
} 