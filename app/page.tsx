'use client';

import { Video, Music, Zap } from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-navy-900 to-blue-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 text-blue-100">Rhythm Cut</h1>
          <p className="text-xl text-blue-200">
            Automatically cut and edit videos to the beat of your music
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Link 
            href="/easyedit"
            className="group bg-blue-900/50 hover:bg-blue-800/50 p-8 rounded-xl transition-all transform hover:scale-105 border border-blue-700/30 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center text-center">
              <Zap className="w-16 h-16 mb-4 text-blue-400" />
              <h2 className="text-2xl font-semibold mb-2 text-blue-100">Easy Edit</h2>
              <p className="text-blue-200">
                Simple 3-step automatic video editing with beat detection
              </p>
            </div>
          </Link>

          <Link 
            href="/edit"
            className="group bg-blue-900/50 hover:bg-blue-800/50 p-8 rounded-xl transition-all transform hover:scale-105 border border-blue-700/30 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center text-center">
              <Video className="w-16 h-16 mb-4 text-blue-400" />
              <h2 className="text-2xl font-semibold mb-2 text-blue-100">Advanced Editor</h2>
              <p className="text-blue-200">
                Full control over beat detection and video synchronization
              </p>
            </div>
          </Link>

          <Link 
            href="/beat-test"
            className="group bg-blue-900/50 hover:bg-blue-800/50 p-8 rounded-xl transition-all transform hover:scale-105 border border-blue-700/30 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center text-center">
              <Music className="w-16 h-16 mb-4 text-blue-400" />
              <h2 className="text-2xl font-semibold mb-2 text-blue-100">Beat Lab</h2>
              <p className="text-blue-200">
                Test and fine-tune beat detection algorithms
              </p>
            </div>
          </Link>
        </div>

        <footer className="mt-16 text-center text-blue-400">
          <p>Version 2.0.3 - Easy Edit & Advanced Beat Detection</p>
        </footer>
      </div>
    </div>
  );
}
