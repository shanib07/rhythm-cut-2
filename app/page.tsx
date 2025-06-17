'use client';

import React from 'react';
import { VideoEditor } from '../src/components/VideoEditor';
import { Toaster } from 'sonner';
import { ErrorBoundary } from 'react-error-boundary';
import { Music } from 'lucide-react';

export default function Home() {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background-light">
          <div className="text-center space-y-4">
            <Music className="w-12 h-12 text-highlight mx-auto" />
            <h1 className="text-xl font-semibold text-text-primary">Error</h1>
            <p className="text-text-secondary">Something went wrong. Please try again.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-button-hover"
            >
              Reload
            </button>
          </div>
        </div>
      }
    >
      <main className="min-h-screen bg-background-light">
        <VideoEditor />
        <Toaster position="bottom-right" />
      </main>
    </ErrorBoundary>
  );
}
