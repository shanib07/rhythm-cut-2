import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  beats: Array<{ timestamp: number; confidence: number }>;
  width?: number;
  height?: number;
  zoom?: number;
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  isPlaying?: boolean;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  audioBuffer,
  beats,
  width = 800,
  height = 200,
  zoom = 1,
  currentTime = 0,
  duration = 0,
  onSeek,
  isPlaying = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [hoveredBeat, setHoveredBeat] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Calculate playhead position based on currentTime
  const playheadPosition = useMemo(() => {
    if (!canvasRef.current || duration === 0) return 0;
    const canvas = canvasRef.current;
    return (currentTime / duration) * canvas.width;
  }, [currentTime, duration]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || !duration) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const seekTime = (x / width) * duration;
    
    onSeek(seekTime);
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !onSeek || !duration) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const seekTime = Math.max(0, Math.min(duration, (x / width) * duration));
    
    onSeek(seekTime);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoveredBeat(null);
  };

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw waveform
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor((channelData.length / canvas.width) / zoom);
    const centerY = canvas.height / 2;

    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x < canvas.width; x++) {
      const sampleIndex = x * samplesPerPixel;
      let min = 1;
      let max = -1;

      // Find min/max in this pixel's sample range
      for (let i = 0; i < samplesPerPixel; i++) {
        const sample = channelData[sampleIndex + i] || 0;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }

      const minY = centerY + (min * centerY * 0.8);
      const maxY = centerY + (max * centerY * 0.8);

      if (x === 0) {
        ctx.moveTo(x, centerY);
      }
      ctx.lineTo(x, minY);
      ctx.lineTo(x, maxY);
    }

    ctx.stroke();

    // Draw beat markers
    beats.forEach((beat, index) => {
      const x = (beat.timestamp / duration) * canvas.width;
      
      ctx.strokeStyle = hoveredBeat === index ? '#ff6b6b' : '#ef4444';
      ctx.lineWidth = hoveredBeat === index ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      // Draw beat number
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.fillText(`${index + 1}`, x + 2, 12);
    });

    // Draw playhead
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadPosition, 0);
    ctx.lineTo(playheadPosition, canvas.height);
    ctx.stroke();

    // Draw time at playhead
    ctx.fillStyle = '#fbbf24';
    ctx.font = '12px monospace';
    const timeText = `${currentTime.toFixed(2)}s`;
    const textWidth = ctx.measureText(timeText).width;
    const textX = Math.max(2, Math.min(playheadPosition - textWidth / 2, canvas.width - textWidth - 2));
    ctx.fillText(timeText, textX, canvas.height - 4);
  }, [audioBuffer, zoom, beats, hoveredBeat, currentTime, duration, playheadPosition]);

  // Draw waveform when dependencies change
  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Animate playhead when playing
  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        drawWaveform();
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      animate();
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, drawWaveform]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full cursor-pointer"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ 
        imageRendering: 'crisp-edges',
        width: '100%',
        height: '100%'
      }}
    />
  );
}; 