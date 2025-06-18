'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Music, Play, Pause, AlertCircle, Volume2, Activity, Clock, Timer, ZoomIn, ZoomOut, RefreshCw, Sliders, Download, ClipboardCopy, ChevronDown, ChevronUp, FileAudio } from 'lucide-react';
import { AudioAnalyzer } from '@/src/services/AudioAnalyzer';
import { WaveformVisualizer } from '@/src/components/WaveformVisualizer';

interface OnsetData {
  timestamp: number;
  confidence: number;
}

interface BeatData {
  timestamp: number;
  confidence: number;
  tempo: number;
}

interface AnalysisResults {
  beatCount: number;
  averageTempo: number;
  confidence: number;
  beats: BeatData[];
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

export default function BeatTestPage() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [beatEnergy, setBeatEnergy] = useState<number>(0);
  const [spectralFlux, setSpectralFlux] = useState<number>(0);
  const [fluxHistory, setFluxHistory] = useState<number[]>([]);
  const [volume, setVolume] = useState<number>(1);
  const [isBeat, setIsBeat] = useState<boolean>(false);
  const [onsets, setOnsets] = useState<OnsetData[]>([]);
  const [beats, setBeats] = useState<BeatData[]>([]);
  const [currentTempo, setCurrentTempo] = useState<number>(120);
  const [tempoConfidence, setTempoConfidence] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);
  const [sensitivity, setSensitivity] = useState<number>(1.0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [showDetailedResults, setShowDetailedResults] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<string>('');
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [fileInfo, setFileInfo] = useState<{
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const [algorithm, setAlgorithm] = useState<'onset' | 'energy' | 'valley'>('onset');
  
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const beatIndicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Initialize AudioAnalyzer with onset detection settings
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
      if (beatIndicatorTimeoutRef.current) {
        clearTimeout(beatIndicatorTimeoutRef.current);
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

  const updateBeatDetection = () => {
    if (analyzerRef.current && isPlaying) {
      const { energy, spectralFlux: flux } = analyzerRef.current.getBeatMetrics();
      const { history } = analyzerRef.current.getSpectralFlux();
      const recentOnsets = analyzerRef.current.findOnsets();
      const recentBeats = analyzerRef.current.trackBeats();
      const { tempo, confidence } = analyzerRef.current.analyzeTempo();
      
      setBeatEnergy(energy);
      setSpectralFlux(flux);
      setFluxHistory(history);
      setOnsets(recentOnsets);
      setBeats(recentBeats);
      setCurrentTempo(tempo);
      setTempoConfidence(confidence);

      // Visual feedback for the most recent beat
      if (recentBeats.length > 0) {
        const lastBeat = recentBeats[recentBeats.length - 1];
        const timeSinceLastBeat = performance.now() / 1000 - lastBeat.timestamp;
        if (timeSinceLastBeat < 0.1) { // Show beat indicator for 100ms
          setIsBeat(true);
          if (beatIndicatorTimeoutRef.current) {
            clearTimeout(beatIndicatorTimeoutRef.current);
          }
          beatIndicatorTimeoutRef.current = setTimeout(() => setIsBeat(false), 100);
        }
      }
      
      // Continue the animation loop
      animationFrameRef.current = requestAnimationFrame(updateBeatDetection);
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.5, 4));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.5, 0.5));
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

      setFileInfo({
        name: file.name,
        type: file.type,
        size: file.size
      });

      // Reset states
      setError('');
      setAudioBuffer(null);
      setBeats([]);
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

      // Initialize analyzer
      if (!analyzerRef.current) {
        analyzerRef.current = new AudioAnalyzer({
          onProgress: (progress) => {
            setAnalysisProgress(progress * 100);
          }
        });
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

  const togglePlayback = async () => {
    if (!audioRef.current || !audioBuffer) return;

    if (isPlaying) {
      // Pause
      audioRef.current.pause();
      if (analyzerRef.current) {
        analyzerRef.current.stop();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setIsPlaying(false);
    } else {
      // Play
      try {
        await audioRef.current.play();
        
        // Ensure analyzer is initialized
        if (!analyzerRef.current || !analyzerRef.current.setAlgorithm) {
          analyzerRef.current = new AudioAnalyzer({
            fftSize: 2048,
            smoothingTimeConstant: 0.8,
            sensitivity: sensitivity
          });
          if (algorithm) {
            analyzerRef.current.setAlgorithm(algorithm);
          }
        }
        
        if (analyzerRef.current) {
          await analyzerRef.current.resume();
          analyzerRef.current.playAudioBuffer(audioBuffer);
        }
        setIsPlaying(true);
        // Start beat detection loop
        updateBeatDetection();
      } catch (err) {
        console.error('Error playing audio:', err);
        setError('Error playing audio');
      }
    }
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    if (analyzerRef.current) {
      analyzerRef.current.setVolume(newVolume);
    }
  };

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatTimestamp = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const handleSensitivityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setSensitivity(value);
    if (analyzerRef.current) {
      analyzerRef.current.setSensitivity(value);
    }
  };

  const handleAnalyze = async () => {
    if (!audioBuffer || isAnalyzing) return;

    try {
      setIsAnalyzing(true);
      setAnalysisProgress(0);
      
      // Ensure analyzer is initialized with latest methods
      if (!analyzerRef.current) {
        analyzerRef.current = new AudioAnalyzer({
          fftSize: 2048,
          smoothingTimeConstant: 0.8,
          sensitivity: sensitivity
        });
      }
      
      // Set the algorithm - check if method exists
      if (analyzerRef.current && typeof analyzerRef.current.setAlgorithm === 'function') {
        analyzerRef.current.setAlgorithm(algorithm);
      } else {
        // Recreate analyzer if method doesn't exist
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
      setBeats(results.beats);
    } catch (err) {
      setError('Error analyzing audio file');
      console.error('Analysis error:', err);
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  const handleReset = () => {
    if (analyzerRef.current) {
      analyzerRef.current.clearBeatHistory();
      setBeats([]);
      setAnalysisResults(null);
    }
  };

  const handleExportJSON = () => {
    if (!analysisResults) return;

    const exportData = {
      metadata: {
        totalBeats: analysisResults.beatCount,
        averageTempo: Math.round(analysisResults.averageTempo),
        confidence: analysisResults.confidence,
        exportDate: new Date().toISOString()
      },
      beats: analysisResults.beats.map(beat => ({
        timestamp: beat.timestamp,
        tempo: Math.round(beat.tempo),
        confidence: beat.confidence
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beat-analysis-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = async () => {
    if (!analysisResults) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(analysisResults.beats, null, 2));
      setCopySuccess('Copied!');
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      setCopySuccess('Failed to copy');
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="min-h-screen p-8 text-primary">
      <header className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2 text-primary">
          <Music className="w-8 h-8" /> Beat Detection Test Lab
        </h1>
      </header>

      <div className="space-y-6">
        {/* File Upload Section */}
        <div className="bg-card-bg p-6 rounded-lg shadow-lg border border-border-color">
          <div className="flex items-center gap-4">
            <label 
              htmlFor="audioFile" 
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md cursor-pointer hover:bg-button-hover transition-colors"
            >
              <FileAudio className="w-5 h-5" />
              Choose File
            </label>
            <input
              type="file"
              id="audioFile"
              accept="audio/*"
              onChange={handleFileChange}
              className="hidden"
            />
            {fileInfo && (
              <div className="text-primary">
                <p className="font-medium">{fileInfo.name}</p>
                <p className="text-sm text-secondary">
                  {(fileInfo.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
            <span className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {error}
            </span>
          </div>
        )}

        {/* Audio Controls */}
        {audioBuffer && (
          <div className="space-y-6">
            <div className="bg-card-bg p-6 rounded-lg shadow-lg border border-border-color">
              <div className="flex items-center gap-4 mb-4">
                <button
                  onClick={togglePlayback}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-button-hover transition-colors"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>

                <div className="flex items-center gap-2 text-primary">
                  <Volume2 className="w-5 h-5" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-24"
                  />
                </div>

                <div className="flex items-center gap-2 text-primary">
                  <Activity className="w-5 h-5" />
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={sensitivity}
                    onChange={handleSensitivityChange}
                    className="w-24"
                  />
                  <span className="text-sm">Sensitivity: {sensitivity.toFixed(1)}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleZoomOut}
                    className="p-2 text-primary hover:bg-gray-100 rounded-md"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleZoomIn}
                    className="p-2 text-primary hover:bg-gray-100 rounded-md"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Waveform Visualization */}
              <div className="relative h-48 bg-card-bg rounded-lg overflow-hidden">
                {audioBuffer && (
                  <WaveformVisualizer
                    audioBuffer={audioBuffer}
                    zoom={zoom}
                    currentTime={currentTime}
                    duration={duration}
                    beats={beats}
                    onSeek={handleSeek}
                    isPlaying={isPlaying}
                  />
                )}
              </div>
              
              {/* Progress Bar and Time Display */}
              <div className="mt-2 flex items-center gap-3">
                <span className="text-sm text-primary font-mono">
                  {formatDuration(currentTime)}
                </span>
                <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-100"
                    style={{ width: `${(currentTime / duration) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-primary font-mono">
                  {formatDuration(duration)}
                </span>
              </div>
            </div>

            {/* Analysis Controls */}
            <div className="bg-card-bg p-6 rounded-lg shadow-lg border border-border-color">
              <div className="flex items-center gap-4 mb-4">
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-button-hover transition-colors disabled:opacity-50"
                >
                  <Activity className="w-5 h-5" />
                  {isAnalyzing ? 'Analyzing...' : 'Analyze Beats'}
                </button>

                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2 border border-border-color text-primary rounded-md hover:bg-gray-100 transition-colors"
                >
                  <RefreshCw className="w-5 h-5" />
                  Reset
                </button>

                {analysisResults && (
                  <button
                    onClick={handleExportJSON}
                    className="flex items-center gap-2 px-4 py-2 border border-border-color text-primary rounded-md hover:bg-gray-100 transition-colors"
                  >
                    <Download className="w-5 h-5" />
                    Export Results
                  </button>
                )}
              </div>

              {/* Algorithm Selection */}
              <div className="flex items-center gap-4 mb-4">
                <label className="text-primary">Detection Algorithm:</label>
                <select
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value as 'onset' | 'energy' | 'valley')}
                  className="px-3 py-2 bg-white border border-border-color rounded-md text-primary"
                >
                  <option value="onset">Advanced Onset Detection (Recommended)</option>
                  <option value="energy">Energy-Based Peak Detection</option>
                  <option value="valley">Valley-to-Peak Detection</option>
                </select>
              </div>

              {isAnalyzing && (
                <div className="mt-4">
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className="bg-primary h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${analysisProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-sm text-secondary mt-2">
                    Analyzing... {analysisProgress.toFixed(1)}%
                  </p>
                </div>
              )}
            </div>

            {/* Results Section */}
            {analysisResults && (
              <div className="bg-card-bg p-6 rounded-lg shadow-lg border border-border-color">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-primary">Analysis Results</h2>
                  <button
                    onClick={() => setShowDetailedResults(!showDetailedResults)}
                    className="flex items-center gap-2 text-primary"
                  >
                    {showDetailedResults ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                    {showDetailedResults ? 'Show Less' : 'Show More'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-primary">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    <span>Beats Detected: {analysisResults.beatCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    <span>Average Tempo: {analysisResults.averageTempo.toFixed(1)} BPM</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Timer className="w-5 h-5" />
                    <span>Confidence: {(analysisResults.confidence * 100).toFixed(1)}%</span>
                  </div>
                </div>

                {showDetailedResults && (
                  <div className="mt-4 space-y-4">
                    {/* Beat Timestamps List */}
                    <div className="bg-gray-800 rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">Beat Timestamps</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                        {analysisResults.beats.map((beat, index) => (
                          <div key={index} className="flex items-center justify-between bg-gray-700 rounded px-3 py-2">
                            <span className="text-gray-300 text-sm">Beat {index + 1}:</span>
                            <span className="text-white font-mono text-sm">{beat.timestamp.toFixed(3)}s</span>
                          </div>
                        ))}
                      </div>
                      {analysisResults.beats.length === 0 && (
                        <p className="text-gray-400 text-center py-4">No beats detected</p>
                      )}
                    </div>
                    
                    {/* Raw JSON Data */}
                    <div className="relative">
                      <h3 className="text-primary font-semibold mb-2">Raw Data</h3>
                      <pre className="bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
                        {JSON.stringify(analysisResults, null, 2)}
                      </pre>
                      <button
                        onClick={handleCopyToClipboard}
                        className="absolute top-2 right-2 p-2 bg-gray-700 text-gray-100 rounded-md hover:bg-gray-600 transition-colors"
                      >
                        <ClipboardCopy className="w-5 h-5" />
                      </button>
                    </div>
                    {copySuccess && (
                      <p className="text-green-500 text-sm">{copySuccess}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 