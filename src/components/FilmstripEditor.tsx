import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react';

interface FilmstripEditorProps {
  videoUrl: string;
  duration: number;
  beatDuration: number;
  onSave: (startTime: number) => void;
  onClose: () => void;
}

export const FilmstripEditor: React.FC<FilmstripEditorProps> = ({
  videoUrl,
  duration,
  beatDuration,
  onSave,
  onClose
}) => {
  const [startTime, setStartTime] = useState(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Generate thumbnails
  useEffect(() => {
    const generateThumbnails = async () => {
      const video = document.createElement('video');
      video.src = videoUrl;
      video.muted = true;
      
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      const thumbnailCount = Math.min(20, Math.floor(duration)); // One thumbnail per second, max 20
      const generatedThumbnails: string[] = [];

      for (let i = 0; i < thumbnailCount; i++) {
        const time = (i / thumbnailCount) * duration;
        video.currentTime = time;
        
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });

        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, 160, 90);
        generatedThumbnails.push(canvas.toDataURL('image/jpeg', 0.8));
      }

      setThumbnails(generatedThumbnails);
      setIsGenerating(false);
    };

    generateThumbnails();
  }, [videoUrl, duration]);

  const handleThumbnailClick = (index: number) => {
    const time = (index / thumbnails.length) * duration;
    setStartTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const scrollAmount = 200;
    scrollContainerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  const maxStartTime = Math.max(0, duration - beatDuration);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-8"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative max-w-4xl w-full bg-gray-900/95 backdrop-blur-xl border border-gray-800 rounded-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-800">
            <h3 className="text-xl font-semibold">Select Video Segment</h3>
            <p className="text-sm text-gray-400 mt-1">
              Choose which {beatDuration.toFixed(1)}s segment to use for this beat
            </p>
          </div>

          {/* Video Preview */}
          <div className="p-6 space-y-6">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                muted
                loop
              />
              
              {/* Segment Overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="absolute top-0 bottom-0 bg-purple-500/20 border-l-2 border-r-2 border-purple-500"
                  style={{
                    left: `${(startTime / duration) * 100}%`,
                    width: `${(beatDuration / duration) * 100}%`
                  }}
                />
              </div>
            </div>

            {/* Timeline Scrubber */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>Start: {startTime.toFixed(1)}s</span>
                <span>End: {(startTime + beatDuration).toFixed(1)}s</span>
              </div>
              
              <input
                type="range"
                min={0}
                max={maxStartTime}
                step={0.1}
                value={startTime}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  setStartTime(value);
                  if (videoRef.current) {
                    videoRef.current.currentTime = value;
                  }
                }}
                className="w-full h-2 bg-gray-700 rounded-full appearance-none cursor-pointer slider"
                style={{
                  background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${(startTime / maxStartTime) * 100}%, #374151 ${(startTime / maxStartTime) * 100}%, #374151 100%)`
                }}
              />
            </div>

            {/* Filmstrip */}
            <div className="relative">
              <button
                onClick={() => handleScroll('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-gray-800/90 backdrop-blur rounded-full hover:bg-gray-700 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              
              <button
                onClick={() => handleScroll('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-gray-800/90 backdrop-blur rounded-full hover:bg-gray-700 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              <div
                ref={scrollContainerRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide py-2 px-12"
              >
                {isGenerating ? (
                  <div className="flex items-center justify-center w-full h-24">
                    <div className="text-gray-400">Generating thumbnails...</div>
                  </div>
                ) : (
                  thumbnails.map((thumbnail, index) => {
                    const time = (index / thumbnails.length) * duration;
                    const isInSegment = time >= startTime && time <= startTime + beatDuration;
                    
                    return (
                      <motion.div
                        key={index}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleThumbnailClick(index)}
                        className={`relative flex-shrink-0 w-40 h-24 rounded-lg overflow-hidden cursor-pointer transition-all ${
                          isInSegment ? 'ring-2 ring-purple-500' : ''
                        }`}
                      >
                        <img
                          src={thumbnail}
                          alt={`Frame at ${time.toFixed(1)}s`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/70 text-xs text-center">
                          {time.toFixed(1)}s
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 border-t border-gray-800 flex items-center justify-end gap-4">
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 transition-colors"
            >
              <X className="w-5 h-5 inline mr-2" />
              Cancel
            </button>
            
            <button
              onClick={() => onSave(startTime)}
              className="px-6 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 font-medium hover:shadow-lg hover:shadow-purple-500/25 transition-all"
            >
              <Check className="w-5 h-5 inline mr-2" />
              Save Selection
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}; 