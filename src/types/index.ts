export interface BeatMarker {
  id: string;
  time: number;
}

export interface VideoClip {
  id: string;
  file: File;
  url: string;
  duration: number;
  name: string;
}

export interface TimelineSegment {
  id: string;
  clipId: string;
  beatStart: number;
  beatEnd: number;
  clipStartTime: number;
  clipEndTime: number;
}

export type ProcessingStatus = 'idle' | 'processing' | 'complete' | 'error';

// Additional helper types
export interface ProcessingError {
  message: string;
  code?: string;
}

export interface VideoState {
  clips: VideoClip[];
  beats: BeatMarker[];
  timeline: TimelineSegment[];
  currentClip: string | null;
  processingStatus: ProcessingStatus;
  error: ProcessingError | null;
} 