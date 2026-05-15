'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, CheckCircle, Cpu, Zap } from 'lucide-react';
import { FFmpegWasmService } from '@/src/services/FFmpegWasmService';

interface FFmpegLoaderProps {
  children: React.ReactNode;
}

/**
 * Wraps page content with an FFmpeg download screen.
 * Shows real-time download progress for the ~31MB WASM engine,
 * then reveals the actual editor once ready.
 */
export const FFmpegLoader: React.FC<FFmpegLoaderProps> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('Preparing...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If already loaded from a previous visit, skip the screen
    const service = FFmpegWasmService.getInstance();
    if (service.getIsLoaded()) {
      setIsReady(true);
      return;
    }

    service
      .loadWithProgress((p, s) => {
        setProgress(Math.round(p * 100));
        setStage(s);
      })
      .then(() => {
        setIsReady(true);
      })
      .catch((err) => {
        console.error('FFmpeg load failed:', err);
        setError(err?.message || 'Failed to download the video engine.');
      });
  }, []);

  if (isReady) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center"
      >
        {/* Animated icon */}
        <motion.div
          animate={{ 
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0]
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity, 
            ease: 'easeInOut' 
          }}
          className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-gradient-to-br from-[#06B6D4] to-[#8B5CF6] mb-8"
        >
          {progress >= 100 ? (
            <CheckCircle className="w-12 h-12 text-white" />
          ) : (
            <Download className="w-12 h-12 text-white" />
          )}
        </motion.div>

        <h2 className="text-2xl font-bold text-white mb-2">
          {progress >= 100 ? 'Engine Ready!' : 'Downloading Video Engine'}
        </h2>
        
        <p className="text-gray-400 mb-6 text-sm">
          {progress >= 100 
            ? 'Starting editor...' 
            : 'This only happens once — the engine is cached for future visits.'}
        </p>

        {/* Progress bar */}
        <div className="w-full h-3 bg-[#334155] rounded-full overflow-hidden mb-3">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#06B6D4] to-[#8B5CF6]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>

        {/* Stage text and percentage */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400 truncate max-w-[70%]">{stage}</span>
          <span className="text-[#06B6D4] font-mono font-bold">{progress}%</span>
        </div>

        {/* Features while waiting */}
        {progress < 80 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="mt-8 space-y-3 text-left"
          >
            <div className="flex items-center gap-3 text-gray-400 text-sm">
              <Cpu className="w-5 h-5 text-[#06B6D4] flex-shrink-0" />
              <span>All video processing happens in your browser</span>
            </div>
            <div className="flex items-center gap-3 text-gray-400 text-sm">
              <Zap className="w-5 h-5 text-[#8B5CF6] flex-shrink-0" />
              <span>No uploads needed — your files never leave your device</span>
            </div>
          </motion.div>
        )}

        {/* Error state */}
        {error && (
          <div className="mt-6 p-4 bg-red-900/30 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm mb-3">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition"
            >
              Retry
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};
