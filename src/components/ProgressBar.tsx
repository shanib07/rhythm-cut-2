import React from 'react';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface ProgressBarProps {
  status: string;
  progress: number;
  message: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  status,
  progress,
  message,
  className = ''
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      case 'processing':
      case 'uploading':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'processing':
      case 'uploading':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />;
    }
  };

  return (
    <div className={`bg-white rounded-lg p-6 shadow-lg border ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        {getStatusIcon()}
        <div>
          <h3 className="font-semibold text-gray-900 capitalize">{status}</h3>
          <p className="text-sm text-gray-600">{message}</p>
        </div>
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Progress</span>
          <span className="text-gray-900 font-medium">{progress}%</span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all duration-300 ease-out ${getStatusColor()}`}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      </div>

      {status === 'completed' && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 text-sm font-medium">
            🎉 Your video has been exported successfully! Download should start automatically.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm font-medium">
            ❌ Export failed. Please check your videos and try again.
          </p>
        </div>
      )}
    </div>
  );
}; 