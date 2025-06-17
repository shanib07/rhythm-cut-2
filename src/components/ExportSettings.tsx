import React from 'react';
import { Settings, Film, FileVideo, Zap } from 'lucide-react';

interface ExportSettingsProps {
  onSettingsChange: (settings: ExportSettings) => void;
  disabled?: boolean;
}

export interface ExportSettings {
  resolution: '720p' | '1080p' | 'original';
  format: 'mp4' | 'webm';
  quality: 'high' | 'medium' | 'low';
}

const RESOLUTIONS = {
  '720p': { width: 1280, height: 720, label: 'HD (720p)' },
  '1080p': { width: 1920, height: 1080, label: 'Full HD (1080p)' },
  'original': { width: null, height: null, label: 'Original Resolution' }
};

const QUALITY_PRESETS = {
  high: { label: 'High Quality', description: 'Best quality, larger file size' },
  medium: { label: 'Balanced', description: 'Good quality, moderate file size' },
  low: { label: 'Compressed', description: 'Smaller file size, reduced quality' }
};

export const ExportSettings: React.FC<ExportSettingsProps> = ({
  onSettingsChange,
  disabled = false
}) => {
  const [settings, setSettings] = React.useState<ExportSettings>({
    resolution: '1080p',
    format: 'mp4',
    quality: 'high'
  });

  const handleChange = (key: keyof ExportSettings, value: string) => {
    const newSettings = {
      ...settings,
      [key]: value
    } as ExportSettings;
    
    setSettings(newSettings);
    onSettingsChange(newSettings);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="flex items-center gap-2 border-b pb-4">
        <Settings className="w-5 h-5 text-gray-500" />
        <h3 className="font-semibold">Export Settings</h3>
      </div>

      {/* Resolution Settings */}
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Film className="w-4 h-4" />
          Resolution
        </label>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(RESOLUTIONS).map(([key, value]) => (
            <button
              key={key}
              onClick={() => handleChange('resolution', key)}
              disabled={disabled}
              className={`p-2 text-sm rounded-lg border transition-colors
                ${settings.resolution === key
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {value.label}
            </button>
          ))}
        </div>
      </div>

      {/* Format Settings */}
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <FileVideo className="w-4 h-4" />
          Format
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleChange('format', 'mp4')}
            disabled={disabled}
            className={`p-2 text-sm rounded-lg border transition-colors
              ${settings.format === 'mp4'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            MP4 (Recommended)
          </button>
          <button
            onClick={() => handleChange('format', 'webm')}
            disabled={disabled}
            className={`p-2 text-sm rounded-lg border transition-colors
              ${settings.format === 'webm'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            WebM
          </button>
        </div>
      </div>

      {/* Quality Settings */}
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Zap className="w-4 h-4" />
          Quality
        </label>
        <div className="space-y-2">
          {Object.entries(QUALITY_PRESETS).map(([key, value]) => (
            <button
              key={key}
              onClick={() => handleChange('quality', key)}
              disabled={disabled}
              className={`w-full p-3 text-left rounded-lg border transition-colors
                ${settings.quality === key
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="font-medium text-sm">
                {value.label}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {value.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}; 