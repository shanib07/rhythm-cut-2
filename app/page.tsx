'use client';

import { Video, Music } from 'lucide-react';
import Link from 'next/link';
import { VideoEditor } from '@/src/components/VideoEditor';

export default function Home() {
  return (
    <main className="min-h-screen p-8 bg-gray-900">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-8">Rhythm Cut</h1>
        <VideoEditor />
      </div>
    </main>
  );
}
