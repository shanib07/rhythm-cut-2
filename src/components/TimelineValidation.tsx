import React, { useMemo } from 'react';
import { AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { TimelineSegment, BeatMarker } from '../types';

interface TimelineValidationProps {
  timeline: TimelineSegment[];
  beats: BeatMarker[];
  onValidationComplete: (isValid: boolean) => void;
}

interface ValidationResult {
  isValid: boolean;
  gaps: { start: number; end: number }[];
  unassignedBeats: number[];
  totalDuration: number;
}

export const TimelineValidation: React.FC<TimelineValidationProps> = ({
  timeline,
  beats,
  onValidationComplete
}) => {
  const validation = useMemo((): ValidationResult => {
    // Sort beats by time
    const sortedBeats = [...beats].sort((a, b) => a.time - b.time);
    
    // Find gaps and unassigned beats
    const gaps: { start: number; end: number }[] = [];
    const unassignedBeats: number[] = [];
    let totalDuration = 0;

    for (let i = 0; i < sortedBeats.length - 1; i++) {
      const currentBeat = sortedBeats[i];
      const nextBeat = sortedBeats[i + 1];
      const segment = timeline.find(
        s => s.beatStart === currentBeat.time && s.beatEnd === nextBeat.time
      );

      if (!segment) {
        gaps.push({
          start: currentBeat.time,
          end: nextBeat.time
        });
        unassignedBeats.push(i);
      }

      totalDuration += nextBeat.time - currentBeat.time;
    }

    const isValid = gaps.length === 0;
    onValidationComplete(isValid);

    return {
      isValid,
      gaps,
      unassignedBeats,
      totalDuration
    };
  }, [timeline, beats, onValidationComplete]);

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      <div className="flex items-center justify-between border-b pb-4">
        <h3 className="font-semibold">Timeline Validation</h3>
        {validation.isValid ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-sm font-medium">Ready to Export</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm font-medium">Issues Found</span>
          </div>
        )}
      </div>

      {/* Duration Information */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
        <Clock className="w-5 h-5 text-gray-500" />
        <div>
          <div className="text-sm font-medium">Total Duration</div>
          <div className="text-2xl font-semibold">{formatTime(validation.totalDuration)}</div>
        </div>
      </div>

      {/* Validation Issues */}
      {!validation.isValid && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-700">Timeline Issues:</div>
          
          {/* Gaps in Timeline */}
          {validation.gaps.map((gap, index) => (
            <div
              key={index}
              className="p-3 bg-amber-50 border border-amber-200 rounded-lg"
            >
              <div className="flex items-center gap-2 text-amber-700 text-sm font-medium">
                <AlertCircle className="w-4 h-4" />
                Gap in Timeline
              </div>
              <div className="mt-1 text-sm text-amber-600">
                {formatTime(gap.start)} - {formatTime(gap.end)}
              </div>
            </div>
          ))}

          {/* Unassigned Beats */}
          {validation.unassignedBeats.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2 text-amber-700 text-sm font-medium">
                <AlertCircle className="w-4 h-4" />
                Unassigned Beat Segments
              </div>
              <div className="mt-1 text-sm text-amber-600">
                {validation.unassignedBeats.length} beat segment(s) need clips assigned
              </div>
            </div>
          )}
        </div>
      )}

      {/* Success Message */}
      {validation.isValid && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-green-700 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Timeline is complete and ready for export
          </div>
        </div>
      )}
    </div>
  );
}; 