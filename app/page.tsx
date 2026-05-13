'use client';

import { Video, Music, Zap } from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-navy-900 to-blue-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 text-blue-100">Rhythm Cut: Comeback</h1>
          <p className="text-xl text-blue-200">
            Automatically cut and edit videos to the beat of your music with blazing speed.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
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
                Full control over beat detection, proxy previews, and rendering
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
                Test and fine-tune ultra-fast O(N log N) FFT algorithms
              </p>
            </div>
          </Link>
        </div>

        <section className="bg-blue-900/30 p-8 rounded-xl border border-blue-700/30 mb-8">
          <h2 className="text-3xl font-semibold mb-6 text-blue-100 text-center">Engineered for Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-blue-200">
            <ul className="space-y-4 list-disc list-inside">
              <li><strong className="text-blue-100">Seamless Proxy Preview:</strong> Flawless playback via on-the-fly server proxies.</li>
              <li><strong className="text-blue-100">Intelligent Auto-Shuffle:</strong> Never repeat consecutive clips while infinitely filling the beat.</li>
              <li><strong className="text-blue-100">Blazing Fast Rendering:</strong> Utilizes FFmpeg concat protocol for sub-second exports.</li>
            </ul>
            <ul className="space-y-4 list-disc list-inside">
              <li><strong className="text-blue-100">Optimized Beat Detection:</strong> O(N log N) FFT ensures zero lag in the browser.</li>
              <li><strong className="text-blue-100">Universal Playback:</strong> Auto-formats to yuv420p so videos work natively on all devices.</li>
              <li><strong className="text-blue-100">Aspect Ratio Enforcement:</strong> Intelligently pads mismatching aspect ratios.</li>
            </ul>
          </div>
        </section>

        <footer className="mt-8 text-center text-blue-400">
          <p>Rhythm Cut Comeback Edition - The Ultimate Beat Sync Editor</p>
        </footer>
      </div>
    </div>
  );
}
