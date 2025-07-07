'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FileAudio, Video, Loader2, Download, Music, Activity, CheckCircle, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { AudioAnalyzer } from '@/src/services/AudioAnalyzer';
import { processVideoWithBeatsDirect } from '@/src/utils/ffmpeg';
import { generateUniqueId } from '@/src/utils/videoUtils';

type Step = 'audio' | 'video' | 'processing' | 'complete';

interface VideoFile {
  id: string;
  file: File;
  name: string;
  duration: number;
}

export default function EasyEditPage() {
  const [currentStep, setCurrentStep] = useState<Step>('audio');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [beatMarkers, setBeatMarkers] = useState<number[]>([]);
  const [showAudioOptions, setShowAudioOptions] = useState(false);
  
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoForAudioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Initialize AudioAnalyzer
    analyzerRef.current = new AudioAnalyzer({
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      sensitivity: 1.0,
      onProgress: (progress) => {
        setProgress(progress * 30); // 0-30% for audio analysis
        setProgressMessage(`Analyzing audio... ${Math.round(progress * 100)}%`);
      }
    });
    
    // Set the algorithm after initialization
    analyzerRef.current.setAlgorithm('onset');

    return () => {
      analyzerRef.current?.dispose();
    };
  }, []);

  const processAudioFromSource = async (file: File, isVideo: boolean = false) => {
    try {
      const fileName = file.name;
      let audioFileToProcess = file;
      
      // If it's a video file, we'll treat it as audio for now
      // In production, you'd want to extract audio server-side
      if (isVideo) {
        toast.info(`Extracting audio from ${fileName}...`);
        // For now, we'll use the video file directly as browsers can handle audio from video
        audioFileToProcess = file;
      } else {
        // Validate audio file
        const validation = await AudioAnalyzer.validateAudioFile(file);
        if (!validation.valid) {
          toast.error(validation.error || 'Invalid audio file');
          return;
        }
      }

      setAudioFile(audioFileToProcess);
      setShowAudioOptions(false);

      // Load and decode audio
      const url = URL.createObjectURL(file);
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);
      
      URL.revokeObjectURL(url);
      toast.success(isVideo ? 'Audio extracted successfully' : 'Audio file loaded successfully');
      
      // Automatically move to video step
      setCurrentStep('video');
    } catch (err) {
      console.error('Error loading audio file:', err);
      toast.error('Error loading audio file. Please try a different file.');
    }
  };

  const handleAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAudioFromSource(file, false);
  };

  const handleVideoToAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAudioFromSource(file, true);
  };

  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      const newVideoFiles: VideoFile[] = [];
      
      for (const file of files) {
        if (!file.type.startsWith('video/')) {
          toast.error(`${file.name} is not a video file`);
          continue;
        }

        if (file.size > 500 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 500MB)`);
          continue;
        }

        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => {
            newVideoFiles.push({
              id: generateUniqueId(),
              file,
              name: file.name,
              duration: video.duration
            });
            URL.revokeObjectURL(video.src);
            resolve();
          };
        });
      }

      if (newVideoFiles.length > 0) {
        setVideoFiles(newVideoFiles);
        toast.success(`${newVideoFiles.length} video(s) loaded successfully`);
      }
    } catch (err) {
      console.error('Error loading video files:', err);
      toast.error('Error loading video files');
    }
  };

  const handleEditVideo = async () => {
    if (!audioFile || !audioBuffer || videoFiles.length === 0) {
      toast.error('Please upload both audio and video files');
      return;
    }

    try {
      setIsProcessing(true);
      setCurrentStep('processing');
      setProgress(0);
      setProgressMessage('Starting process...');

      // Step 1: Analyze audio
      setIsAnalyzing(true);
      setProgressMessage('Analyzing audio beats...');
      
      if (!analyzerRef.current) {
        throw new Error('Audio analyzer not initialized');
      }

      const analysisResults = await analyzerRef.current.analyzeAudioBuffer(audioBuffer);
      
      // Create beat markers from analysis results
      const beats = [0, ...analysisResults.beats.map(beat => beat.timestamp)];
      setBeatMarkers(beats);
      
      setProgress(30);
      setProgressMessage(`Found ${analysisResults.beats.length} beats. Preparing video...`);
      toast.success(`Detected ${analysisResults.beats.length} beats in the audio`);

      // Add a small delay for better UX
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 2: Process video with beats
      setProgressMessage('Processing video with beat synchronization...');
      
      const videoData = videoFiles.map(vf => ({
        file: vf.file,
        id: vf.id
      }));

      const outputUrl = await processVideoWithBeatsDirect(
        videoData,
        beats,
        audioFile,
        'Easy Edit Video',
        'balanced', // Use balanced quality as requested
        (progress) => {
          setProgress(30 + progress * 70); // 30-100% for video processing
          const stage = progress < 0.3 ? 'Uploading files' : 
                       progress < 0.9 ? 'Processing video' : 
                       'Finalizing';
          setProgressMessage(`${stage}... ${Math.round(progress * 100)}%`);
        }
      );

      setDownloadUrl(outputUrl);
      setCurrentStep('complete');
      setProgressMessage('Video processing complete!');
      toast.success('Video edited successfully!');

      // Automatically download the file
      const link = document.createElement('a');
      link.href = outputUrl;
      link.download = 'edited-video.mp4';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (err) {
      console.error('Error processing video:', err);
      toast.error(err instanceof Error ? err.message : 'Error processing video');
      setCurrentStep(videoFiles.length > 0 ? 'video' : 'audio');
    } finally {
      setIsAnalyzing(false);
      setIsProcessing(false);
    }
  };

  const resetProcess = () => {
    setCurrentStep('audio');
    setAudioFile(null);
    setAudioBuffer(null);
    setVideoFiles([]);
    setProgress(0);
    setProgressMessage('');
    setDownloadUrl(null);
    setBeatMarkers([]);
    setShowAudioOptions(false);
    
    // Reset file inputs
    if (audioInputRef.current) audioInputRef.current.value = '';
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h1 className="text-4xl font-bold text-white mb-3 flex items-center justify-center gap-3">
            <Activity className="w-10 h-10 text-[#06B6D4]" />
            Easy Edit
          </h1>
          <p className="text-gray-400 text-lg">
            Automatically sync your videos to music beats in 3 simple steps
          </p>
        </motion.div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-10">
          <div className="flex items-center gap-4">
            {/* Step 1: Audio */}
            <div className={`flex items-center gap-2 ${currentStep === 'audio' ? 'text-[#06B6D4]' : 
              ['video', 'processing', 'complete'].includes(currentStep) ? 'text-green-500' : 'text-gray-500'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 
                ${currentStep === 'audio' ? 'border-[#06B6D4] bg-[#06B6D4]/20' : 
                ['video', 'processing', 'complete'].includes(currentStep) ? 'border-green-500 bg-green-500/20' : 
                'border-gray-500'}`}>
                {['video', 'processing', 'complete'].includes(currentStep) ? 
                  <CheckCircle className="w-6 h-6" /> : <Music className="w-6 h-6" />}
              </div>
              <span className="font-medium">Audio</span>
            </div>

            <div className={`w-20 h-0.5 ${['video', 'processing', 'complete'].includes(currentStep) ? 
              'bg-green-500' : 'bg-gray-500'}`} />

            {/* Step 2: Video */}
            <div className={`flex items-center gap-2 ${currentStep === 'video' ? 'text-[#06B6D4]' : 
              ['processing', 'complete'].includes(currentStep) ? 'text-green-500' : 'text-gray-500'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 
                ${currentStep === 'video' ? 'border-[#06B6D4] bg-[#06B6D4]/20' : 
                ['processing', 'complete'].includes(currentStep) ? 'border-green-500 bg-green-500/20' : 
                'border-gray-500'}`}>
                {['processing', 'complete'].includes(currentStep) ? 
                  <CheckCircle className="w-6 h-6" /> : <Video className="w-6 h-6" />}
              </div>
              <span className="font-medium">Videos</span>
            </div>

            <div className={`w-20 h-0.5 ${currentStep === 'complete' ? 'bg-green-500' : 'bg-gray-500'}`} />

            {/* Step 3: Process */}
            <div className={`flex items-center gap-2 ${currentStep === 'processing' ? 'text-[#06B6D4]' : 
              currentStep === 'complete' ? 'text-green-500' : 'text-gray-500'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 
                ${currentStep === 'processing' ? 'border-[#06B6D4] bg-[#06B6D4]/20 animate-pulse' : 
                currentStep === 'complete' ? 'border-green-500 bg-green-500/20' : 
                'border-gray-500'}`}>
                {currentStep === 'complete' ? <CheckCircle className="w-6 h-6" /> : 
                 currentStep === 'processing' ? <Loader2 className="w-6 h-6 animate-spin" /> : 
                 <Download className="w-6 h-6" />}
              </div>
              <span className="font-medium">Export</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <AnimatePresence mode="wait">
          {/* Audio Upload Step */}
          {currentStep === 'audio' && (
            <motion.div
              key="audio"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="bg-[#1E293B] rounded-xl p-8 border border-[#334155]"
            >
              <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-3">
                <FileAudio className="w-8 h-8 text-[#06B6D4]" />
                Step 1: Upload Your Audio
              </h2>
              
              {!showAudioOptions ? (
                <div
                  onClick={() => setShowAudioOptions(true)}
                  className="block w-full p-10 border-2 border-dashed border-[#475569] rounded-lg 
                           hover:border-[#06B6D4] transition-colors cursor-pointer text-center
                           hover:bg-[#06B6D4]/5"
                >
                  <Music className="w-16 h-16 mx-auto mb-4 text-[#06B6D4]" />
                  <p className="text-white text-lg mb-2">
                    Click to select audio source
                  </p>
                  <p className="text-gray-400 text-sm">
                    Import audio file or extract from video
                  </p>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-4"
                >
                  {/* Import Audio File Option */}
                  <label
                    htmlFor="audioUpload"
                    className="block p-6 border-2 border-[#475569] rounded-lg 
                             hover:border-[#06B6D4] transition-colors cursor-pointer
                             hover:bg-[#06B6D4]/5"
                  >
                    <input
                      ref={audioInputRef}
                      type="file"
                      id="audioUpload"
                      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.weba,.webm"
                      onChange={handleAudioFileChange}
                      className="hidden"
                    />
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-[#06B6D4]/20 rounded-full flex items-center justify-center">
                        <Music className="w-8 h-8 text-[#06B6D4]" />
                      </div>
                      <div>
                        <p className="text-white text-lg font-medium">Import Audio File</p>
                        <p className="text-gray-400 text-sm">MP3, WAV, M4A, AAC, OGG</p>
                      </div>
                    </div>
                  </label>

                  {/* Extract Audio from Video Option */}
                  <label
                    htmlFor="videoToAudioUpload"
                    className="block p-6 border-2 border-[#475569] rounded-lg 
                             hover:border-[#06B6D4] transition-colors cursor-pointer
                             hover:bg-[#06B6D4]/5"
                  >
                                         <input
                       ref={videoForAudioInputRef}
                       type="file"
                       id="videoToAudioUpload"
                       accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.3gp,.wmv"
                       onChange={handleVideoToAudioFileChange}
                       className="hidden"
                     />
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-[#0891B2]/20 rounded-full flex items-center justify-center">
                        <Video className="w-8 h-8 text-[#0891B2]" />
                      </div>
                      <div>
                        <p className="text-white text-lg font-medium">Extract Audio from Video</p>
                        <p className="text-gray-400 text-sm">MP4, MOV, AVI, MKV, WebM</p>
                      </div>
                    </div>
                  </label>

                  <button
                    onClick={() => setShowAudioOptions(false)}
                    className="w-full text-sm text-gray-400 hover:text-white transition-colors mt-2"
                  >
                    Cancel
                  </button>
                </motion.div>
              )}

              {audioFile && !showAudioOptions && (
                <div className="mt-4 p-4 bg-[#0F172A] rounded-lg">
                  <p className="text-green-400 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Video Upload Step */}
          {currentStep === 'video' && (
            <motion.div
              key="video"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="bg-[#1E293B] rounded-xl p-8 border border-[#334155]"
            >
              <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-3">
                <Video className="w-8 h-8 text-[#06B6D4]" />
                Step 2: Upload Your Videos
              </h2>
              
              <label
                htmlFor="videoUpload"
                className="block w-full p-10 border-2 border-dashed border-[#475569] rounded-lg 
                         hover:border-[#06B6D4] transition-colors cursor-pointer text-center
                         hover:bg-[#06B6D4]/5"
              >
                <input
                  ref={videoInputRef}
                  type="file"
                  id="videoUpload"
                  accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.3gp,.wmv"
                  multiple
                  onChange={handleVideoFileChange}
                  className="hidden"
                />
                <Upload className="w-16 h-16 mx-auto mb-4 text-[#06B6D4]" />
                <p className="text-white text-lg mb-2">
                  Drop your video files here or click to browse
                </p>
                <p className="text-gray-400 text-sm">
                  You can select multiple videos (max 500MB each)
                </p>
              </label>

              {videoFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {videoFiles.map((video, index) => (
                    <div key={video.id} className="p-3 bg-[#0F172A] rounded-lg flex items-center justify-between">
                      <span className="text-green-400 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5" />
                        {index + 1}. {video.name} ({video.duration.toFixed(1)}s)
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {videoFiles.length > 0 && (
                <button
                  onClick={handleEditVideo}
                  className="mt-6 w-full py-4 bg-[#06B6D4] text-white font-semibold rounded-lg
                           hover:bg-[#0891B2] transition-colors flex items-center justify-center gap-3"
                >
                  <Activity className="w-6 h-6" />
                  Edit Video Automatically
                </button>
              )}
            </motion.div>
          )}

          {/* Processing Step */}
          {currentStep === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#1E293B] rounded-xl p-8 border border-[#334155] text-center"
            >
              <div className="mb-6">
                <Loader2 className="w-20 h-20 mx-auto text-[#06B6D4] animate-spin mb-4" />
                <h2 className="text-2xl font-semibold text-white mb-2">
                  Processing Your Video
                </h2>
                <p className="text-gray-400">
                  {progressMessage}
                </p>
              </div>

              <div className="w-full h-4 bg-[#0F172A] rounded-full overflow-hidden mb-4">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#06B6D4] to-[#0891B2]"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              <p className="text-[#06B6D4] font-mono text-lg">
                {Math.round(progress)}%
              </p>

              {beatMarkers.length > 0 && (
                <p className="text-gray-400 mt-4 text-sm">
                  Syncing {videoFiles.length} video{videoFiles.length > 1 ? 's' : ''} to {beatMarkers.length - 1} beats
                </p>
              )}
            </motion.div>
          )}

          {/* Complete Step */}
          {currentStep === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#1E293B] rounded-xl p-8 border border-[#334155] text-center"
            >
              <div className="mb-6">
                <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle className="w-12 h-12 text-green-500" />
                </div>
                <h2 className="text-2xl font-semibold text-white mb-2">
                  Video Edited Successfully!
                </h2>
                <p className="text-gray-400">
                  Your video has been synchronized with the music beats
                </p>
              </div>

              <div className="space-y-4">
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download="edited-video.mp4"
                    className="inline-flex items-center gap-3 px-6 py-3 bg-green-500 text-white font-semibold rounded-lg
                             hover:bg-green-600 transition-colors"
                  >
                    <Download className="w-6 h-6" />
                    Download Video
                  </a>
                )}

                <button
                  onClick={resetProcess}
                  className="block w-full py-3 bg-[#334155] text-white font-medium rounded-lg
                           hover:bg-[#475569] transition-colors"
                >
                  Create Another Video
                </button>
              </div>

              <div className="mt-6 p-4 bg-[#0F172A] rounded-lg">
                <p className="text-gray-400 text-sm">
                  <strong>Video Details:</strong> {videoFiles.length} clips synchronized to {beatMarkers.length - 1} beats
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Help Text */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 text-center text-gray-400 text-sm"
        >
          <p>
            Easy Edit automatically detects beats in your music and syncs your video clips to create 
            professional-looking edits without any manual work.
          </p>
        </motion.div>
      </div>
    </div>
  );
} 