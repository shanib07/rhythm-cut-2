'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Music, Video, Play, Pause, AlertCircle, Volume2, Activity, Clock, Timer, ZoomIn, ZoomOut, RefreshCw, Download, ChevronDown, ChevronUp, FileAudio, ArrowLeft, Info, Share2, BarChart3, Loader2 } from 'lucide-react';
import { AudioAnalyzer } from '@/src/services/AudioAnalyzer';
import { WaveformVisualizer } from '@/src/components/WaveformVisualizer';
import { VideoEditor } from '@/src/components/VideoEditor';
import { FFmpegVideoEditor } from '@/src/components/FFmpegVideoEditor';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useVideoStore } from '@/src/stores/videoStore';
import { generateUniqueId } from '@/src/utils/videoUtils';

interface OnsetData {
  timestamp: number;
  confidence: number;
}

interface AnalysisResults {
  beatCount: number;
  averageTempo: number;
  confidence: number;
  beats: { timestamp: number; confidence: number; tempo: number; }[];
}

export default function EditPage() {
  // Audio Analysis States
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [sensitivity, setSensitivity] = useState<number>(1.0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [algorithm, setAlgorithm] = useState<'onset' | 'energy' | 'valley'>('onset');
  const [showAudioSection, setShowAudioSection] = useState<boolean>(true);

  // Video Store Actions
  const { 
    addBeat,
    setAudioFile,
    setAudioUrl,
    setAudioBuffer,
    audioFile,
    audioUrl,
    audioBuffer
  } = useVideoStore();

  // Refs
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize AudioAnalyzer
    analyzerRef.current = new AudioAnalyzer({
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      maxFrequency: 5000,
      minOnsetGap: 100,
      thresholdMultiplier: 1.5,
      windowSize: 40,
      minTempo: 60,
      maxTempo: 200
    });

    // Create audio element
    audioRef.current = new Audio();
    audioRef.current.addEventListener('timeupdate', handleTimeUpdate);
    audioRef.current.addEventListener('ended', handleAudioEnded);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      analyzerRef.current?.dispose();
      if (audioRef.current) {
        audioRef.current.removeEventListener('timeupdate', handleTimeUpdate);
        audioRef.current.removeEventListener('ended', handleAudioEnded);
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(duration);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Validate file format and size
      const validation = await AudioAnalyzer.validateAudioFile(file);
      if (!validation.valid) {
        setError(validation.error || 'Invalid file');
        return;
      }

      // Reset states
      setError('');
      setAudioBuffer(null);
      setAnalysisResults(null);
      setIsPlaying(false);
      setCurrentTime(0);
      
      // Stop current audio if playing
      if (audioRef.current) {
        audioRef.current.pause();
      }

      // Create file URL and set audio file
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setAudioFile(file);

      // Set audio source
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.volume = volume;
      }

      // Load and decode audio
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);
      setDuration(buffer.duration);

    } catch (err) {
      console.error('Error loading audio file:', err);
      setError('Error loading audio file. Please try a different file.');
    }
  };

  const handleAnalyze = async () => {
    if (!audioBuffer || isAnalyzing) return;

    try {
      setIsAnalyzing(true);
      
      // Ensure analyzer is initialized with latest methods
      if (!analyzerRef.current) {
        analyzerRef.current = new AudioAnalyzer({
          fftSize: 2048,
          smoothingTimeConstant: 0.8,
          sensitivity: sensitivity
        });
      }
      
      // Set the algorithm
      if (analyzerRef.current && typeof analyzerRef.current.setAlgorithm === 'function') {
        analyzerRef.current.setAlgorithm(algorithm);
      } else {
        analyzerRef.current?.dispose();
        analyzerRef.current = new AudioAnalyzer({
          fftSize: 2048,
          smoothingTimeConstant: 0.8,
          sensitivity: sensitivity
        });
        analyzerRef.current.setAlgorithm(algorithm);
      }
      
      analyzerRef.current.setSensitivity(sensitivity);
      
      const results = await analyzerRef.current.analyzeAudioBuffer(audioBuffer);
      setAnalysisResults(results);

      // Automatically add beats to video editor
      results.beats.forEach(beat => {
        addBeat({
          id: generateUniqueId(),
          time: beat.timestamp
        });
      });

      toast.success(`Added ${results.beats.length} beat markers to video editor`);
      setShowAudioSection(false); // Collapse audio section after analysis

    } catch (err) {
      setError('Error analyzing audio file');
      console.error('Analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const togglePlayback = async () => {
    if (!audioRef.current || !audioBuffer) return;

    if (isPlaying) {
      audioRef.current.pause();
      if (analyzerRef.current) {
        analyzerRef.current.stop();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Error playing audio:', err);
        setError('Error playing audio');
      }
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const handleSensitivityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setSensitivity(value);
    if (analyzerRef.current) {
      analyzerRef.current.setSensitivity(value);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] p-8 text-gray-100">
      <header className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2 text-white">
          <Video className="w-8 h-8 text-[#06B6D4]" /> Beat-Sync Video Editor (FFmpeg-Powered)
        </h1>
        <p className="text-gray-400 mt-2">High-performance video editing with FFmpeg.wasm</p>
      </header>

      <div className="space-y-6">
        {/* Audio Analysis Section */}
        <div className="bg-[#1E293B] p-6 rounded-lg shadow-lg border border-[#334155]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-white">
              <Music className="w-6 h-6 text-[#06B6D4]" />
              Audio Analysis
            </h2>
            <button
              onClick={() => setShowAudioSection(!showAudioSection)}
              className="p-2 hover:bg-[#334155] rounded-full text-gray-300 hover:text-white transition-colors"
            >
              {showAudioSection ? <ChevronUp /> : <ChevronDown />}
            </button>
          </div>

          {showAudioSection && (
            <div className="space-y-4">
              {/* File Upload */}
              <div className="flex items-center gap-4">
                <label 
                  htmlFor="audioFile" 
                  className="flex items-center gap-2 px-4 py-2 bg-[#06B6D4] text-white rounded-md cursor-pointer hover:bg-[#0891B2] transition-colors"
                >
                  <FileAudio className="w-5 h-5" />
                  Choose Audio File
                </label>
                <input
                  type="file"
                  id="audioFile"
                  accept="audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {audioFile && (
                  <span className="text-sm text-gray-300">
                    {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                )}
              </div>

              {error && (
                <div className="bg-[#7F1D1D] border border-[#EF4444] text-white px-4 py-3 rounded relative">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                  </span>
                </div>
              )}

              {audioBuffer && (
                <>
                  {/* Audio Controls */}
                  <div className="flex items-center gap-4">
                    <button
                      onClick={togglePlayback}
                      className="flex items-center gap-2 px-4 py-2 bg-[#06B6D4] text-white rounded-md hover:bg-[#0891B2] transition-colors"
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>

                    <div className="flex items-center gap-2 text-gray-300">
                      <Volume2 className="w-5 h-5" />
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={volume}
                        onChange={handleVolumeChange}
                        className="w-24 accent-[#06B6D4]"
                      />
                    </div>

                    <div className="flex items-center gap-2 text-gray-300">
                      <Activity className="w-5 h-5" />
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={sensitivity}
                        onChange={handleSensitivityChange}
                        className="w-24 accent-[#06B6D4]"
                      />
                      <span className="text-sm">Sensitivity: {sensitivity.toFixed(1)}</span>
                    </div>
                  </div>

                  {/* Algorithm Selection */}
                  <div className="flex items-center gap-4">
                    <label className="text-gray-300">Detection Algorithm:</label>
                    <select
                      value={algorithm}
                      onChange={(e) => setAlgorithm(e.target.value as 'onset' | 'energy' | 'valley')}
                      className="px-3 py-2 bg-[#334155] border border-[#475569] rounded-md text-white focus:border-[#06B6D4] focus:ring-1 focus:ring-[#06B6D4] outline-none"
                    >
                      <option value="onset">Advanced Onset Detection (Recommended)</option>
                      <option value="energy">Energy-Based Peak Detection</option>
                      <option value="valley">Valley-to-Peak Detection</option>
                    </select>
                  </div>

                  {/* Analyze Button */}
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="flex items-center gap-2 px-4 py-2 bg-[#06B6D4] text-white rounded-md hover:bg-[#0891B2] transition-colors disabled:opacity-50 disabled:hover:bg-[#06B6D4]"
                  >
                    <Activity className="w-5 h-5" />
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Beats'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Improved Video Editor Section */}
        <VideoEditor />
      </div>
    </div>
  );
} 