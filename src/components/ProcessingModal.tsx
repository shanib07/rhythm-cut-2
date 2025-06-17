import React from 'react';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';

interface ProcessingModalProps {
  progress: number;
  message?: string;
  onCancel: () => void;
}

export const ProcessingModal: React.FC<ProcessingModalProps> = ({
  progress,
  message = 'Processing...',
  onCancel
}) => {
  const percentage = Math.round(progress * 100);
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Processing Video</h3>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            {message}
          </div>
          
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-blue-500"
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          
          <div className="text-right text-sm text-gray-600">
            {percentage}%
          </div>
        </div>
      </div>
    </div>
  );
}; 