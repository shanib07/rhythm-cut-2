'use client';

import { Video, Music } from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-800 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">Rhythm Cut</h1>
          <p className="text-xl text-gray-300">
            Automatically cut and edit videos to the beat of your music
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Link 
            href="/edit"
            className="group bg-green-800 hover:bg-green-700 p-8 rounded-xl transition-all transform hover:scale-105"
          >
            <div className="flex flex-col items-center text-center">
              <Video className="w-16 h-16 mb-4 text-primary" />
              <h2 className="text-2xl font-semibold mb-2">Beat-Sync Editor</h2>
              <p className="text-gray-400">
                Upload your audio and video files to automatically create beat-synchronized edits
              </p>
            </div>
          </Link>

          <Link 
            href="/beat-test"
            className="group bg-green-800 hover:bg-green-700 p-8 rounded-xl transition-all transform hover:scale-105"
          >
            <div className="flex flex-col items-center text-center">
              <Music className="w-16 h-16 mb-4 text-primary" />
              <h2 className="text-2xl font-semibold mb-2">Beat Detection Lab</h2>
              <p className="text-gray-400">
                Test and fine-tune beat detection algorithms with detailed visualization
              </p>
            </div>
          </Link>
        </div>

        <footer className="mt-16 text-center text-gray-500">
          <p>Version 2.0.1 - Green Theme & Advanced Beat Detection</p>
        </footer>
      </div>
    </div>
  );
}
