'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Play, Pause, Download, Edit2, Plus, FileAudio, Sparkles, Film, ChevronLeft, ChevronRight, Check, Info, Music, Video, ChevronDown } from 'lucide-react';
import { AudioAnalyzer } from '@/src/services/AudioAnalyzer';
import { toast } from 'sonner';
import { useVideoStore } from '@/src/stores/videoStore';
import { generateUniqueId } from '@/src/utils/videoUtils';
import { processVideoWithBeatsDirect, processVideoWithBeats } from '@/src/utils/ffmpeg';
import { hybridVideoExport, getAvailableExportMethods, EXPORT_METHODS } from '@/src/utils/hybridExport';
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
  const [exportQuality, setExportQuality] = useState<'fast' | 'balanced' | 'high'>('balanced');
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [hoveredBeatIndex, setHoveredBeatIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Removed showSettings state - no longer needed
  const [editingBeatIndex, setEditingBeatIndex] = useState<number | null>(null);
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [currentPreviewBeat, setCurrentPreviewBeat] = useState<number>(0);
  const [showAudioOptions, setShowAudioOptions] = useState(false);
  const [videoLoadingProgress, setVideoLoadingProgress] = useState<Record<string, number>>({});
  const [previewLoadingState, setPreviewLoadingState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [exportCapabilities, setExportCapabilities] = useState({
    webCodecs: false,
    webAssembly: false,
    serverProcessing: true,
    mediaRecorder: false
  });

  // Refs
  const audioFileRef = useRef<File | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoForAudioInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const nextVideoRef = useRef<HTMLVideoElement>(null); // Preload next video
  const timelineRef = useRef<HTMLDivElement>(null);

  // Video Store
  const { 
    setAudioFile,
    setAudioUrl,
    setAudioBuffer,
    audioUrl
  } = useVideoStore();

  // Initialize Audio Analyzer and detect export capabilities
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

    // Detect export capabilities on client side
    setExportCapabilities(getAvailableExportMethods());

    return () => {
      analyzerRef.current?.dispose();
    };
  }, []);

  // Update video preview based on current beat with smooth transitions
  const updateVideoPreview = useCallback((beatIndex: number) => {
    if (!previewVideoRef.current || !beats[beatIndex]?.videoClip) return;
    
    const beat = beats[beatIndex];
    const video = previewVideoRef.current;
    
    // Only update if video source changed
    if (beat.videoClip && video.src !== beat.videoClip.url) {
      // Store playing state
      const wasPlaying = !video.paused;
      
      // Calculate the time offset within this beat
      const beatStartTime = beat.time;
      const currentAudioTime = audioRef.current?.currentTime || 0;
      const timeIntoBeat = Math.max(0, currentAudioTime - beatStartTime);
      
      // Update video source
      video.src = beat.videoClip.url;
      
      // Set video time based on beat configuration and audio sync
      const videoStartTime = (beat.videoClip.startTime || 0) + timeIntoBeat;
      
      // Ensure we don't exceed video duration
      video.onloadedmetadata = () => {
        const clampedTime = Math.min(videoStartTime, video.duration - 0.1);
        video.currentTime = clampedTime;
        
        // Resume playing if it was playing
        if (wasPlaying && isPlaying) {
          video.play().catch(err => {
            console.warn('Video play failed:', err);
          });
        }
      };
    }
  }, [beats, isPlaying]);

  // Audio time update handler with beat synchronization
  useEffect(() => {
    if (audioRef.current) {
      const handleTimeUpdate = () => {
        const time = audioRef.current!.currentTime;
        setCurrentTime(time);
        
        // Find which beat should be playing based on current time
        if (isPlaying && beats.length > 0) {
          let beatIndex = 0;
          
          // Find the current beat based on audio time
          for (let i = 0; i < beats.length; i++) {
            if (time >= beats[i].time) {
              beatIndex = i;
            } else {
              break;
            }
          }
          
          // Update preview if beat changed
          if (beatIndex !== currentPreviewBeat) {
            setCurrentPreviewBeat(beatIndex);
            updateVideoPreview(beatIndex);
          }
        }
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
  }, [audioUrl, isPlaying, beats, currentPreviewBeat, updateVideoPreview]);

  // Preload next video for smooth transitions
  useEffect(() => {
    if (!isPlaying || !beats.length || currentPreviewBeat >= beats.length - 1) return;
    
    const nextBeat = beats[currentPreviewBeat + 1];
    if (!nextBeat?.videoClip || !nextVideoRef.current) return;
    
    // Preload next video
    const nextVideo = nextVideoRef.current;
    if (nextVideo.src !== nextBeat.videoClip.url) {
      nextVideo.src = nextBeat.videoClip.url;
      nextVideo.load();
    }
  }, [currentPreviewBeat, beats, isPlaying]);

  // Process audio from source
  const processAudioFromSource = async (file: File, isVideo: boolean = false) => {
    try {
      setIsAnalyzing(true);
      setShowAudioOptions(false);
      
      const fileName = file.name;
      let audioFileToProcess = file;
      
      // If it's a video file, we'll treat it as audio for now
      // In production, you'd want to extract audio server-side
      if (isVideo) {
        toast.info(`Extracting audio from ${fileName}...`);
        // For now, we'll use the video file directly as browsers can handle audio from video
        audioFileToProcess = file;
      }
      
      audioFileRef.current = audioFileToProcess;
      
      // Create audio URL
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setAudioFile(audioFileToProcess);

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
      toast.error('Failed to analyze audio');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Audio Upload Handler
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAudioFromSource(file, false);
  };

  // Video to Audio Upload Handler
  const handleVideoToAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAudioFromSource(file, true);
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
      toast.success('All beats have video clips assigned! You can now preview or export.');
      
      // Start intelligent preview loading
      startPreviewLoading(newBeats);
    }
  };

  // Intelligent Preview Loading System
  const startPreviewLoading = async (beatsToLoad: Beat[]) => {
    setPreviewLoadingState('loading');
    console.log('🎬 Starting intelligent preview loading...');
    
    try {
      // Load videos in priority order: current, next, previous, then rest
      const loadingPromises = beatsToLoad.map(async (beat, index) => {
        if (!beat.videoClip) return;
        
        const priority = index === 0 ? 0 : index === 1 ? 1 : 100 + index;
        
        return new Promise<void>((resolve) => {
          setTimeout(async () => {
            await preloadVideo(beat.videoClip!.url, beat.id);
            resolve();
          }, priority * 100); // Stagger loading based on priority
        });
      });

      // Set first video immediately for instant preview
      if (beatsToLoad[0]?.videoClip && previewVideoRef.current) {
        previewVideoRef.current.src = beatsToLoad[0].videoClip.url;
        console.log('🎬 First video set for immediate preview');
      }

      // Wait for priority videos to load
      await Promise.all(loadingPromises.slice(0, 3));
      setPreviewLoadingState('ready');
      
      // Continue loading remaining videos in background
      if (loadingPromises.length > 3) {
        Promise.all(loadingPromises.slice(3)).then(() => {
          console.log('🎬 All videos preloaded');
        });
      }
      
    } catch (error) {
      console.error('Preview loading failed:', error);
      setPreviewLoadingState('error');
      toast.error('Some videos failed to load for preview');
    }
  };

  // Preload individual video with progress tracking
  const preloadVideo = async (url: string, beatId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      
      const updateProgress = () => {
        if (video.duration) {
          const progress = (video.buffered.length > 0 ? video.buffered.end(0) / video.duration : 0) * 100;
          setVideoLoadingProgress(prev => ({ ...prev, [beatId]: progress }));
        }
      };
      
      video.addEventListener('loadedmetadata', () => {
        updateProgress();
        console.log(`📹 Video metadata loaded: ${url.split('/').pop()}`);
      });
      
      video.addEventListener('canplaythrough', () => {
        setVideoLoadingProgress(prev => ({ ...prev, [beatId]: 100 }));
        console.log(`✅ Video ready: ${url.split('/').pop()}`);
        resolve();
      });
      
      video.addEventListener('progress', updateProgress);
      
      video.addEventListener('error', (e) => {
        console.error(`❌ Video load error: ${url}`, e);
        reject(e);
      });
      
      video.src = url;
    });
  };

  // Enhanced Export Handler with Hybrid Processing
  const handleExport = async () => {
    if (!audioFileRef.current || beats.some(beat => !beat.videoClip)) {
      toast.error('Please ensure all beats have video clips assigned');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    
    // Show export method being used
    const method = exportCapabilities.webCodecs && exportQuality === 'fast' ? 'WebCodecs' : 
                   exportCapabilities.mediaRecorder && beats.length <= 5 ? 'Canvas' : 'Server';
    setExportMessage(`Starting ${method} export...`);

    try {
      const videosForProcessing = beats.map(beat => ({
        file: beat.videoClip!.file,
        id: beat.videoClip!.id,
        startTime: beat.videoClip!.startTime || 0
      }));

      const beatMarkers = [0, ...beats.map(beat => beat.time)];
      
      // Try hybrid export system first (much faster for supported browsers)
      let outputUrl: string;
      
      try {
        console.log('🚀 Attempting hybrid export...');
        outputUrl = await hybridVideoExport(
          videosForProcessing,
          beatMarkers,
          audioFileRef.current,
          {
            quality: exportQuality,
            onProgress: (progress, message) => {
              setExportProgress(Math.round(progress));
              setExportMessage(message);
            }
          }
        );
        
        toast.success(`Export completed using ${method} processing!`);
        
      } catch (hybridError) {
        console.warn('Hybrid export failed, falling back to server:', hybridError);
        
        // Fallback to original server processing
        setExportMessage('Falling back to server processing...');
        
        const useQueue = exportQuality === 'high';
        
        if (useQueue) {
          outputUrl = await processVideoWithBeats(
            videosForProcessing,
            beatMarkers,
            `Rhythm Cut Export - ${new Date().toISOString()}`,
            (progress) => {
              setExportProgress(Math.round(progress * 100));
              
              if (progress < 0.2) {
                setExportMessage('Uploading files...');
              } else if (progress < 0.8) {
                setExportMessage('Processing video (server)...');
              } else {
                setExportMessage('Finalizing...');
              }
            }
          );
        } else {
          outputUrl = await processVideoWithBeatsDirect(
            videosForProcessing,
            beatMarkers,
            audioFileRef.current,
            `Rhythm Cut Export - ${new Date().toISOString()}`,
            exportQuality,
            (progress) => {
              setExportProgress(Math.round(progress * 100));
              
              if (progress < 0.2) {
                setExportMessage('Uploading files...');
              } else if (progress < 0.8) {
                setExportMessage(`Processing video (${exportQuality} mode)...`);
              } else {
                setExportMessage('Finalizing...');
              }
            }
          );
        }
      }

      setExportProgress(100);
      setExportMessage('Export complete!');

      // Trigger download
      const downloadLink = document.createElement('a');
      downloadLink.href = outputUrl;
      downloadLink.download = `rhythm-cut-${Date.now()}.mp4`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      setTimeout(() => {
        toast.success('Video exported successfully!');
        setCurrentStep('export');
      }, 500);
    } catch (error) {
      console.error('Export error:', error);
      
      // Provide more helpful error messages
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          toast.error('Export timed out. Try using "Fast Export" for quicker results.');
        } else if (error.message.includes('upload')) {
          toast.error('Failed to upload files. Please check your connection and try again.');
        } else if (error.message.includes('processing')) {
          toast.error('Video processing failed. Try reducing the number of clips or using lower quality.');
        } else {
          toast.error(`Export failed: ${error.message}`);
        }
      } else {
        toast.error('Failed to export video. Please try again.');
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Play/Pause Handler with proper synchronization
  const togglePlayback = async () => {
    if (!audioRef.current || beats.some(beat => !beat.videoClip)) {
      toast.error('Please add all video clips before preview');
      return;
    }
    
    if (isPlaying) {
      // Pause both audio and video
      audioRef.current.pause();
      previewVideoRef.current?.pause();
      setIsPlaying(false);
    } else {
      try {
        // Find current beat and update preview first
        const currentAudioTime = audioRef.current.currentTime;
        let beatIndex = 0;
        
        for (let i = 0; i < beats.length; i++) {
          if (currentAudioTime >= beats[i].time) {
            beatIndex = i;
          } else {
            break;
          }
        }
        
        // Update preview to correct beat
        if (beatIndex !== currentPreviewBeat) {
          setCurrentPreviewBeat(beatIndex);
          updateVideoPreview(beatIndex);
        }
        
        // Start audio playback
        await audioRef.current.play();
        
        // Start video playback with slight delay to ensure sync
        setTimeout(() => {
          if (previewVideoRef.current && previewVideoRef.current.src) {
            previewVideoRef.current.play().catch(err => {
              console.warn('Video autoplay failed:', err);
            });
          }
        }, 50);
        
        setIsPlaying(true);
      } catch (err) {
        console.error('Playback error:', err);
        toast.error('Failed to start playback');
        setIsPlaying(false);
      }
    }
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

  // Seek to specific time
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    // Update audio time
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    
    // Find and update beat
    let beatIndex = 0;
    for (let i = 0; i < beats.length; i++) {
      if (newTime >= beats[i].time) {
        beatIndex = i;
      } else {
        break;
      }
    }
    
    if (beatIndex !== currentPreviewBeat) {
      setCurrentPreviewBeat(beatIndex);
      updateVideoPreview(beatIndex);
    }
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
              {!isAnalyzing && !showAudioOptions ? (
                <motion.div
                  className="relative group cursor-pointer"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAudioOptions(true)}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity" />
                  
                  <div className="relative block bg-gray-900/90 backdrop-blur-xl border border-gray-800 rounded-2xl p-12 text-center overflow-hidden">
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
                      <p className="text-gray-400">Click to select audio source</p>
                    </motion.div>
                  </div>
                </motion.div>
              ) : showAudioOptions ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold text-center mb-6">Choose Audio Source</h2>
                  
                  {/* Import Audio File */}
                  <label
                    htmlFor="audioInput"
                    className="block relative group cursor-pointer"
                  >
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="relative"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl blur-lg opacity-30 group-hover:opacity-50 transition-opacity" />
                      <div className="relative bg-gray-900/90 backdrop-blur-xl border border-gray-800 rounded-xl p-6 flex items-center gap-4 hover:border-purple-500/50 transition-colors">
                        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <Music className="w-8 h-8" />
                        </div>
                        <div className="text-left">
                          <h3 className="text-lg font-semibold">Import Audio File</h3>
                          <p className="text-sm text-gray-400">MP3, WAV, M4A, AAC, OGG</p>
                        </div>
                      </div>
                    </motion.div>
                    <input
                      ref={fileInputRef}
                      id="audioInput"
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.weba,.webm"
                      onChange={handleAudioUpload}
                      className="hidden"
                    />
                  </label>

                  {/* Import Audio from Video */}
                  <label
                    htmlFor="videoAudioInput"
                    className="block relative group cursor-pointer"
                  >
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="relative"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl blur-lg opacity-30 group-hover:opacity-50 transition-opacity" />
                      <div className="relative bg-gray-900/90 backdrop-blur-xl border border-gray-800 rounded-xl p-6 flex items-center gap-4 hover:border-blue-500/50 transition-colors">
                        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <Video className="w-8 h-8" />
                        </div>
                        <div className="text-left">
                          <h3 className="text-lg font-semibold">Extract Audio from Video</h3>
                          <p className="text-sm text-gray-400">MP4, MOV, AVI, MKV, WebM</p>
                        </div>
                      </div>
                    </motion.div>
                    <input
                      ref={videoForAudioInputRef}
                      id="videoAudioInput"
                      type="file"
                      accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.3gp,.wmv"
                      onChange={handleVideoToAudioUpload}
                      className="hidden"
                    />
                  </label>

                  <button
                    onClick={() => setShowAudioOptions(false)}
                    className="w-full mt-4 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
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
                      accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.3gp,.wmv"
                      multiple
                      onChange={handleVideoUpload}
                      className="hidden"
                    />
                  </label>

                  {/* Export with quality options */}
                  <div className="relative z-[1000]">
                    <button
                      onClick={() => setShowExportOptions(!showExportOptions)}
                      disabled={beats.some(beat => !beat.videoClip) || isExporting}
                      className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-purple-500/25 transition-all flex items-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      Export
                      <ChevronDown className={`w-3 h-3 transition-transform ${showExportOptions ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {/* Export quality dropdown */}
                    {showExportOptions && !isExporting && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[999]">
                        <div className="p-2">
                          <button
                            onClick={() => {
                              setExportQuality('fast');
                              setShowExportOptions(false);
                              handleExport();
                            }}
                            className="w-full text-left px-3 py-2 rounded hover:bg-gray-700 transition-colors"
                          >
                            <div className="font-medium text-sm flex items-center gap-2">
                              Fast Export
                              {exportCapabilities.webCodecs && (
                                <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                                  WebCodecs
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400">
                              {exportCapabilities.webCodecs ? 'Ultra-fast browser processing' : 'Lower quality, quick preview'}
                            </div>
                          </button>
                          
                          <button
                            onClick={() => {
                              setExportQuality('balanced');
                              setShowExportOptions(false);
                              handleExport();
                            }}
                            className="w-full text-left px-3 py-2 rounded hover:bg-gray-700 transition-colors"
                          >
                            <div className="font-medium text-sm flex items-center gap-2">
                              Balanced Export
                              {exportCapabilities.mediaRecorder && beats.length <= 5 && (
                                <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                                  Canvas
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400">
                              {exportCapabilities.mediaRecorder && beats.length <= 5 ? 'Fast canvas rendering' : 'Good quality, moderate speed'}
                            </div>
                          </button>
                          
                          <button
                            onClick={() => {
                              setExportQuality('high');
                              setShowExportOptions(false);
                              handleExport();
                            }}
                            className="w-full text-left px-3 py-2 rounded hover:bg-gray-700 transition-colors"
                          >
                            <div className="font-medium text-sm">High Quality</div>
                            <div className="text-xs text-gray-400">Best quality, slower processing</div>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Helper message */}
            {beats.filter(b => !b.videoClip).length > 0 && (
              <div className="px-6 py-2 bg-blue-500/10 border-b border-blue-500/20">
                <p className="text-sm text-blue-300 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Please add {beats.filter(b => !b.videoClip).length} more video{beats.filter(b => !b.videoClip).length > 1 ? 's' : ''} to match the detected beats
                </p>
              </div>
            )}

            {/* Main Content */}
            <div className="flex-1 flex flex-col p-6 gap-4">
              {/* Preview Area */}
              <div className="flex-1 relative max-h-[50vh]">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-blue-500/10 rounded-xl" />
                <div className="relative h-full bg-gray-900/50 backdrop-blur-xl border border-gray-800/50 rounded-xl overflow-hidden">
                  {beats[0]?.videoClip ? (
                    <>
                      <video
                        ref={previewVideoRef}
                        className="w-full h-full object-contain"
                        controls={false}
                        muted
                      />
                      {/* Hidden video for preloading next clip */}
                      <video
                        ref={nextVideoRef}
                        className="hidden"
                        muted
                        preload="auto"
                      />
                      
                      {/* Preview Loading Overlay */}
                      {previewLoadingState === 'loading' && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                          <div className="text-center">
                            <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4"></div>
                            <p className="text-white font-medium">Loading preview videos...</p>
                            <p className="text-gray-400 text-sm mt-1">Optimizing for smooth playback</p>
                          </div>
                        </div>
                      )}
                    </>
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
                  {audioUrl && (
                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                      <div className="flex items-center gap-3">
                    <button
                      onClick={togglePlayback}
                          className="p-2 rounded-full bg-white/10 backdrop-blur-xl hover:bg-white/20 transition-colors"
                          disabled={beats.some(beat => !beat.videoClip)}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </button>

                        <div className="flex-1">
                          <div 
                            className="h-1 bg-white/20 rounded-full cursor-pointer relative group"
                            onClick={handleSeek}
                          >
                            <div 
                              className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all pointer-events-none" 
                              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} 
                            />
                            {/* Beat markers */}
                            {beats.map((beat, index) => (
                              <div
                                key={beat.id}
                                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2 bg-white/30 pointer-events-none"
                                style={{ left: `${(beat.time / duration) * 100}%` }}
                                title={`Beat ${index + 1}`}
                              />
                            ))}
                          </div>
                        </div>
                        
                        <span className="text-xs font-mono">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                    </div>

                      {beats.length > 0 && (
                        <div className="mt-2 text-xs text-gray-400 text-center">
                          Beat {currentPreviewBeat + 1} of {beats.length}
                        </div>
                      )}
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
                            setCurrentPreviewBeat(index);
                            updateVideoPreview(index);
                          }
                        }}
                      >
                        <div className={`relative w-32 h-20 rounded-lg overflow-hidden cursor-pointer transition-all ${
                          selectedBeatIndex === index ? 'ring-2 ring-purple-500' : ''
                        } ${currentPreviewBeat === index && isPlaying ? 'ring-2 ring-green-500' : ''}`}>
                          {beat.videoClip ? (
                            <>
                              <img
                                src={beat.videoClip.thumbnailUrl || ''}
                                alt={beat.videoClip.name}
                                className="w-full h-full object-cover"
                              />
                              
                              {beat.videoClip.startTime && beat.videoClip.startTime > 0 && (
                                <div className="absolute top-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-xs">
                                  <Check className="w-3 h-3 inline mr-1" />
                                  Edited
                    </div>
                  )}
                              
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
                                accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.3gp,.wmv"
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

            {/* Removed settings panel - no longer needed */}

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
              {/* Progress percentage above circle */}
              <div className="mb-8">
                <div className="text-5xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                  {exportProgress}%
                </div>
              </div>

              {/* Animated Logo */}
              <div className="relative w-40 h-40 mx-auto mb-8">
                {/* Outer glow ring */}
                <motion.div
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.3, 0.6, 0.3]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full blur-2xl"
                />
                
                {/* Main circle background */}
                <div className="absolute inset-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full" />
                
                {/* Inner circle with icon */}
                <div className="absolute inset-8 bg-gray-900 rounded-full flex items-center justify-center">
                  <Film className="w-16 h-16 text-white" />
                </div>
                
                {/* Progress Ring */}
                <svg className="absolute inset-0 -rotate-90">
                  <circle
                    cx="80"
                    cy="80"
                    r="76"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="76"
                    stroke="url(#gradient)"
                    strokeWidth="8"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 76}`}
                    strokeDashoffset={`${2 * Math.PI * 76 * (1 - exportProgress / 100)}`}
                    className="transition-all duration-500"
                  />
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#a855f7" />
                      <stop offset="50%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* Text below circle */}
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">Exporting Your Video</h2>
                <p className="text-gray-400 text-sm">{exportMessage}</p>
        </div>

              {/* Animated dots */}
              <div className="flex justify-center gap-3 mt-6">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ 
                      scale: [1, 1.5, 1],
                      opacity: [0.3, 1, 0.3]
                    }}
                    transition={{ 
                      duration: 1.5, 
                      repeat: Infinity, 
                      delay: i * 0.2 
                    }}
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
                  setCurrentPreviewBeat(0);
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