'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';

export function VideoEditor() {
  const [videos, setVideos] = useState<File[]>([]);
  const [beatMarkers, setBeatMarkers] = useState<number[]>([]);
  const [processing, setProcessing] = useState(false);

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'video/*': ['.mp4', '.webm', '.mov']
    },
    onDrop: (acceptedFiles) => {
      setVideos(prev => [...prev, ...acceptedFiles]);
    }
  });

  const handleAddBeatMarker = (time: number) => {
    setBeatMarkers(prev => [...prev, time].sort((a, b) => a - b));
  };

  const handleProcessVideos = async () => {
    if (!videos.length || !beatMarkers.length) return;

    setProcessing(true);
    try {
      const formData = new FormData();
      videos.forEach((video, index) => {
        formData.append(`video${index}`, video);
      });
      formData.append('beatMarkers', JSON.stringify(beatMarkers));

      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Processing failed');

      const data = await response.json();
      console.log('Processing started:', data);
    } catch (error) {
      console.error('Error processing videos:', error);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div {...getRootProps()} className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors">
        <input {...getInputProps()} />
        <p className="text-gray-300">Drag and drop videos here, or click to select files</p>
      </div>

      {videos.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-white">Uploaded Videos</h3>
          <ul className="space-y-2">
            {videos.map((video, index) => (
              <li key={video.name} className="text-gray-300">
                {index + 1}. {video.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-white">Beat Markers</h3>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.1"
            placeholder="Time in seconds"
            className="px-3 py-2 bg-gray-800 text-white rounded"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const input = e.currentTarget;
                const time = parseFloat(input.value);
                if (!isNaN(time)) {
                  handleAddBeatMarker(time);
                  input.value = '';
                }
              }
            }}
          />
          <button
            onClick={handleProcessVideos}
            disabled={processing || !videos.length || !beatMarkers.length}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? 'Processing...' : 'Process Videos'}
          </button>
        </div>

        {beatMarkers.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {beatMarkers.map((time, index) => (
              <li
                key={index}
                className="px-3 py-1 bg-gray-800 text-white rounded-full text-sm"
                onClick={() => {
                  setBeatMarkers(prev => prev.filter((_, i) => i !== index));
                }}
              >
                {time.toFixed(1)}s
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
} 