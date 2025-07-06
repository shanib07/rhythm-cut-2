'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Loader2, Play, Pause, Download, Edit2, Plus, FileAudio, Settings, Sparkles } from 'lucide-react';
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
  const [exportQuality, setExportQuality] = useState<'720p' | '1080p' | '4K'>('1080p');
  const [hoveredBeatIndex, setHoveredBeatIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [editingBeatIndex, setEditingBeatIndex] = useState<number | null>(null);
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});

  // Refs
  const audioFileRef = useRef<File | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

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
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, 320, 180);
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

    try {
      const videosForProcessing = beats.map(beat => ({
        file: beat.videoClip!.file,
        id: beat.videoClip!.id,
        startTime: beat.videoClip!.startTime || 0
      }));

      const beatMarkers = [0, ...beats.map(beat => beat.time)];
      
      // Map quality to FFmpeg settings
      const qualityMap = {
        '720p': 'fast',
        '1080p': 'balanced',
        '4K': 'high'
      };

      const outputUrl = await processVideoWithBeatsDirect(
        videosForProcessing,
        beatMarkers,
        audioFileRef.current,
        `Rhythm Cut Export - ${new Date().toISOString()}`,
        qualityMap[exportQuality] as 'fast' | 'balanced' | 'high',
        (progress) => {
          setExportProgress(Math.round(progress * 100));
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
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
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
            <div className="px-8 py-4 border-b border-gray-800/50 backdrop-blur-xl bg-gray-900/50">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Video Editor</h1>
                
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                  
                  <button
                    onClick={handleExport}
                    disabled={beats.some(beat => !beat.videoClip) || isExporting}
                    className="px-6 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-purple-500/25 transition-all"
                  >
                    {isExporting ? (
                      <>
                        <Loader2 className="w-5 h-5 inline mr-2 animate-spin" />
                        Exporting {exportProgress}%
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5 inline mr-2" />
                        Export
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col p-8 gap-6">
              {/* Preview Area */}
              <div className="flex-1 relative">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 via-transparent to-blue-500/20 rounded-2xl" />
                <div className="relative h-full bg-gray-900/50 backdrop-blur-xl border border-gray-800/50 rounded-2xl overflow-hidden">
                  {selectedBeatIndex !== null && beats[selectedBeatIndex]?.videoClip ? (
                    <video
                      src={beats[selectedBeatIndex].videoClip.url}
                      className="w-full h-full object-contain"
                      controls
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="w-32 h-32 mx-auto mb-4 bg-gray-800/50 rounded-full flex items-center justify-center">
                          <Play className="w-16 h-16 text-gray-600" />
                        </div>
                        <p className="text-gray-400">Select a clip to preview</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Playback Controls */}
                  <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={togglePlayback}
                        className="p-3 rounded-full bg-white/10 backdrop-blur-xl hover:bg-white/20 transition-colors"
                        disabled={!audioUrl}
                      >
                        {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                      </button>
                      
                      <div className="flex-1">
                        <div className="h-1 bg-white/20 rounded-full">
                          <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full" style={{ width: '0%' }} />
                        </div>
                      </div>
                      
                      <span className="text-sm font-mono">0:00 / 0:00</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800/50 rounded-2xl p-6">
                <div className="flex items-center gap-4 overflow-x-auto pb-4">
                  {beats.map((beat, index) => (
                    <motion.div
                      key={beat.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex-shrink-0"
                      onMouseEnter={() => setHoveredBeatIndex(index)}
                      onMouseLeave={() => setHoveredBeatIndex(null)}
                      onClick={() => setSelectedBeatIndex(index)}
                    >
                      <div className={`relative w-48 h-32 rounded-lg overflow-hidden cursor-pointer transition-all ${
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
                                    className="p-2 rounded-lg bg-white/20 backdrop-blur-xl hover:bg-white/30 transition-colors"
                                  >
                                    <Edit2 className="w-5 h-5" />
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
                            <Plus className="w-8 h-8 text-gray-500" />
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
                        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/80 backdrop-blur-xl">
                          <p className="text-xs font-mono text-center">
                            {beat.duration.toFixed(1)}s
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  
                  {/* Import videos button */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: beats.length * 0.1 }}
                    className="flex-shrink-0"
                  >
                    <label
                      htmlFor="video-bulk"
                      className="w-48 h-32 bg-gray-800/30 border-2 border-dashed border-gray-700 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-700/30 transition-colors"
                    >
                      <Upload className="w-8 h-8 text-gray-500 mb-2" />
                      <span className="text-sm text-gray-500">Import videos</span>
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
                  </motion.div>
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
                  className="absolute right-0 top-16 h-[calc(100%-4rem)] w-80 bg-gray-900/95 backdrop-blur-xl border-l border-gray-800/50 p-6"
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
                        className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors"
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