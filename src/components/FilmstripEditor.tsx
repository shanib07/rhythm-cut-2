import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, X, GripVertical } from 'lucide-react';

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
  const [thumbnails, setThumbnails] = useState<{ url: string; time: number }[]>([]);
  const [isGenerating, setIsGenerating] = useState(true);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'middle' | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);

  // Generate thumbnails at intervals
  useEffect(() => {
    const generateThumbnails = async () => {
      const video = document.createElement('video');
      video.src = videoUrl;
      video.muted = true;
      
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      // Generate thumbnail every 0.5 seconds, max 60 thumbnails
      const interval = Math.max(0.5, duration / 60);
      const thumbnailCount = Math.min(60, Math.floor(duration / interval));
      const generatedThumbnails: { url: string; time: number }[] = [];

      for (let i = 0; i <= thumbnailCount; i++) {
        const time = i * interval;
        if (time > duration) break;
        
        video.currentTime = time;
        
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });

        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 56;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, 100, 56);
        generatedThumbnails.push({
          url: canvas.toDataURL('image/jpeg', 0.8),
          time
        });
      }

      setThumbnails(generatedThumbnails);
      setIsGenerating(false);
      
      // Auto-zoom for very long videos
      if (duration > 60) {
        setTimelineZoom(Math.min(3, duration / 60));
      }
    };

    generateThumbnails();
  }, [videoUrl, duration]);

  // Update video preview when start time changes
  useEffect(() => {
    if (videoRef.current && !isDragging) {
      videoRef.current.currentTime = startTime;
    }
  }, [startTime, isDragging]);

  // Auto-scroll to keep selection visible
  useEffect(() => {
    if (scrollContainerRef.current && filmstripRef.current && !isDragging) {
      const container = scrollContainerRef.current;
      const selectionPos = timeToPixel(startTime);
      const containerWidth = container.clientWidth;
      const scrollLeft = container.scrollLeft;
      
      // If selection is out of view, scroll to center it
      if (selectionPos < scrollLeft + 100 || selectionPos > scrollLeft + containerWidth - 100) {
        container.scrollTo({
          left: selectionPos - containerWidth / 2,
          behavior: 'smooth'
        });
      }
    }
  }, [startTime]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const scrollAmount = 300;
    scrollContainerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  const maxStartTime = Math.max(0, duration - beatDuration);
  const endTime = Math.min(startTime + beatDuration, duration);

  // Convert time to pixel position with zoom
  const timeToPixel = (time: number) => {
    if (!thumbnails.length) return 0;
    const pixelsPerThumbnail = 100 * timelineZoom;
    const thumbnailsPerSecond = thumbnails.length / duration;
    return time * thumbnailsPerSecond * pixelsPerThumbnail;
  };

  // Convert pixel position to time with zoom
  const pixelToTime = (pixel: number) => {
    if (!thumbnails.length) return 0;
    const pixelsPerThumbnail = 100 * timelineZoom;
    const thumbnailsPerSecond = thumbnails.length / duration;
    return Math.max(0, Math.min(duration, pixel / (thumbnailsPerSecond * pixelsPerThumbnail)));
  };

  // Handle mouse down on selection
  const handleMouseDown = (e: React.MouseEvent, type: 'start' | 'end' | 'middle') => {
    e.preventDefault();
    setIsDragging(type);
    setDragStartX(e.clientX);
    setDragStartTime(startTime);
  };

  // Handle mouse move
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !filmstripRef.current) return;

      const deltaX = e.clientX - dragStartX;
      const deltaTime = pixelToTime(Math.abs(deltaX)) * (deltaX < 0 ? -1 : 1);

      if (isDragging === 'start') {
        const newStartTime = Math.max(0, Math.min(endTime - 0.1, dragStartTime + deltaTime));
        setStartTime(newStartTime);
      } else if (isDragging === 'end') {
        const newEndTime = Math.max(startTime + 0.1, Math.min(duration, dragStartTime + beatDuration + deltaTime));
        const newStartTime = newEndTime - beatDuration;
        setStartTime(Math.max(0, newStartTime));
      } else if (isDragging === 'middle') {
        const newStartTime = Math.max(0, Math.min(maxStartTime, dragStartTime + deltaTime));
        setStartTime(newStartTime);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(null);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStartX, dragStartTime, startTime, endTime, maxStartTime, beatDuration, duration]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 sm:p-8"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative max-w-5xl w-full max-h-[90vh] bg-gray-900/95 backdrop-blur-xl border border-gray-800 rounded-2xl overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-3 border-b border-gray-800 flex-shrink-0">
            <h3 className="text-lg font-semibold">Edit Video Segment</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Select a {beatDuration.toFixed(1)}s segment from your video
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {/* Video Preview */}
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                muted
                loop
                playsInline
              />
              
              {/* Time indicators */}
              <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur px-2 py-1 rounded text-xs font-mono">
                {startTime.toFixed(1)}s - {endTime.toFixed(1)}s
              </div>
            </div>

            {/* Filmstrip Timeline */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-300">Timeline</h4>
                <div className="flex items-center gap-2">
                  {duration > 30 && (
                    <div className="flex items-center gap-1 text-xs">
                      <button
                        onClick={() => setTimelineZoom(Math.max(1, timelineZoom - 0.5))}
                        className="px-2 py-0.5 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
                      >
                        -
                      </button>
                      <span className="text-gray-400 w-10 text-center">{timelineZoom}x</span>
                      <button
                        onClick={() => setTimelineZoom(Math.min(5, timelineZoom + 0.5))}
                        className="px-2 py-0.5 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
                      >
                        +
                      </button>
                    </div>
                  )}
                  <span className="text-xs text-gray-500">
                    Click and drag to adjust
                  </span>
                </div>
              </div>

              <div className="relative">
                {/* Navigation buttons */}
                <button
                  onClick={() => handleScroll('left')}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-20 p-1 bg-gray-800/90 backdrop-blur rounded-full hover:bg-gray-700 transition-colors"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                
                <button
                  onClick={() => handleScroll('right')}
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-20 p-1 bg-gray-800/90 backdrop-blur rounded-full hover:bg-gray-700 transition-colors"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>

                {/* Filmstrip container */}
                <div 
                  ref={scrollContainerRef}
                  className="overflow-x-auto scrollbar-hide px-8"
                >
                  <div 
                    ref={filmstripRef}
                    className="relative h-14"
                    style={{ width: `${thumbnails.length * 100 * timelineZoom}px` }}
                  >
                    {/* Thumbnails */}
                    <div className="absolute inset-0 flex">
                      {isGenerating ? (
                        <div className="flex items-center justify-center w-full">
                          <div className="text-gray-400 text-sm">Generating timeline...</div>
                        </div>
                      ) : (
                        thumbnails.map((thumbnail, index) => (
                          <div
                            key={index}
                            className="relative flex-shrink-0 h-full border-r border-gray-800/50"
                            style={{ width: `${100 * timelineZoom}px` }}
                          >
                            <img
                              src={thumbnail.url}
                              alt={`Frame at ${thumbnail.time.toFixed(1)}s`}
                              className="w-full h-full object-cover"
                            />
                            {/* Time marker every second or at intervals for long videos */}
                            {(duration <= 30 ? thumbnail.time % 1 === 0 : thumbnail.time % 5 === 0) && (
                              <div className="absolute bottom-0 left-0 bg-black/70 px-1 text-xs">
                                {thumbnail.time.toFixed(0)}s
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Selection overlay */}
                    {!isGenerating && (
                      <div className="absolute inset-y-0 pointer-events-none">
                        {/* Non-selected areas */}
                        <div 
                          className="absolute inset-y-0 left-0 bg-black/60"
                          style={{ width: `${timeToPixel(startTime)}px` }}
                        />
                        <div 
                          className="absolute inset-y-0 right-0 bg-black/60"
                          style={{ left: `${timeToPixel(endTime)}px` }}
                        />
                        
                        {/* Selected area */}
                        <div
                          className="absolute inset-y-0 border-2 border-purple-500 pointer-events-auto"
                          style={{
                            left: `${timeToPixel(startTime)}px`,
                            width: `${timeToPixel(beatDuration)}px`
                          }}
                        >
                          {/* Start handle */}
                          <div
                            className="absolute left-0 inset-y-0 w-2 bg-purple-500 cursor-ew-resize hover:bg-purple-400 transition-colors flex items-center justify-center"
                            onMouseDown={(e) => handleMouseDown(e, 'start')}
                          >
                            <GripVertical className="w-3 h-3 text-white" />
                          </div>
                          
                          {/* End handle */}
                          <div
                            className="absolute right-0 inset-y-0 w-2 bg-purple-500 cursor-ew-resize hover:bg-purple-400 transition-colors flex items-center justify-center"
                            onMouseDown={(e) => handleMouseDown(e, 'end')}
                          >
                            <GripVertical className="w-3 h-3 text-white" />
                          </div>
                          
                          {/* Middle area (for dragging entire selection) */}
                          <div
                            className="absolute inset-0 cursor-move"
                            style={{ left: '8px', right: '8px' }}
                            onMouseDown={(e) => handleMouseDown(e, 'middle')}
                          />
                          
                          {/* Selection info */}
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap">
                            {beatDuration.toFixed(1)}s
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Playhead indicator */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white/50 pointer-events-none"
                      style={{ left: `${timeToPixel(videoRef.current?.currentTime || startTime)}px` }}
                    />
                  </div>
                </div>
              </div>

              {/* Fine adjustment slider */}
              <div className="px-8">
                <input
                  type="range"
                  min={0}
                  max={maxStartTime}
                  step={0.1}
                  value={startTime}
                  onChange={(e) => setStartTime(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer slider"
                  style={{
                    background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${(startTime / maxStartTime) * 100}%, #374151 ${(startTime / maxStartTime) * 100}%, #374151 100%)`
                  }}
                />
              </div>
            </div>
          </div>

          {/* Actions - Always visible */}
          <div className="px-6 py-3 border-t border-gray-800 flex items-center justify-between bg-gray-900/95 backdrop-blur flex-shrink-0">
            <div className="text-sm text-gray-400">
              Duration: <span className="text-white font-medium">{beatDuration.toFixed(1)}s</span>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 transition-colors text-sm"
              >
                Cancel
              </button>
              
              <button
                onClick={() => onSave(startTime)}
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 font-medium hover:shadow-lg hover:shadow-purple-500/25 transition-all text-sm"
              >
                <Check className="w-3 h-3 inline mr-1.5" />
                Apply Selection
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}; 