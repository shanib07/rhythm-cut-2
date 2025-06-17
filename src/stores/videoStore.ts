import { create } from 'zustand';
import { VideoClip, BeatMarker, TimelineSegment } from '../types';

export interface VideoThumbnail {
  time: number;
  url: string;
}

export interface Video {
  id: string;
  url: string;
  thumbnails: VideoThumbnail[];
  duration: number;
}

export interface ProcessingProgress {
  value: number;
  message?: string;
}

interface VideoStore {
  // Video management
  clips: VideoClip[];
  beats: BeatMarker[];
  timeline: TimelineSegment[];
  currentClip: string | null;
  
  // UI state
  error: string | null;
  isLoading: boolean;
  isProcessing: boolean;
  processingProgress: {
    value: number;
    message?: string;
  } | null;
  
  // Actions
  addClip: (clip: VideoClip) => void;
  removeClip: (id: string) => void;
  setCurrentClip: (id: string | null) => void;
  
  addBeat: (beat: BeatMarker) => void;
  removeBeat: (id: string) => void;
  updateBeat: (id: string, time: number) => void;
  
  addTimelineSegment: (segment: TimelineSegment) => void;
  removeTimelineSegment: (id: string) => void;
  
  setError: (error: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  setProcessing: (isProcessing: boolean) => void;
  setProcessingProgress: (progress: { value: number; message?: string; } | null) => void;
}

export const useVideoStore = create<VideoStore>((set) => ({
  // Initial state with empty arrays
  clips: [],
  beats: [],
  timeline: [],
  currentClip: null,
  
  // UI state
  error: null,
  isLoading: false,
  isProcessing: false,
  processingProgress: null,
  
  // Clip actions
  addClip: (clip) => set((state) => ({
    clips: [...state.clips, clip],
    currentClip: clip.id,
    error: null
  })),
  
  removeClip: (id) => set((state) => ({
    clips: state.clips.filter(c => c.id !== id),
    currentClip: state.currentClip === id ? null : state.currentClip,
    // Remove timeline segments using this clip
    timeline: state.timeline.filter(t => t.clipId !== id)
  })),
  
  setCurrentClip: (id) => set({ currentClip: id }),
  
  // Beat actions
  addBeat: (beat) => set((state) => ({
    beats: [...state.beats].sort((a, b) => a.time - b.time)
  })),
  
  removeBeat: (id) => set((state) => ({
    beats: state.beats.filter(b => b.id !== id),
    // Remove timeline segments using this beat
    timeline: state.timeline.filter(t => 
      !state.beats.some(b => b.id === id && (t.beatStart === b.time || t.beatEnd === b.time))
    )
  })),
  
  updateBeat: (id, time) => set((state) => ({
    beats: state.beats.map(b => 
      b.id === id ? { ...b, time } : b
    ).sort((a, b) => a.time - b.time)
  })),
  
  // Timeline actions
  addTimelineSegment: (segment) => set((state) => ({
    timeline: [...state.timeline, segment]
  })),
  
  removeTimelineSegment: (id) => set((state) => ({
    timeline: state.timeline.filter(t => t.id !== id)
  })),
  
  // UI actions
  setError: (error) => set({ error }),
  setLoading: (isLoading) => set({ isLoading }),
  setProcessing: (isProcessing) => set({
    isProcessing,
    processingProgress: isProcessing ? { value: 0 } : null
  }),
  setProcessingProgress: (progress) => set({ processingProgress: progress })
})); 