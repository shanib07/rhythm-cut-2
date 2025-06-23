'use client';

import { Video, Music } from 'lucide-react';
import Link from 'next/link';
import { ServerVideoEditor } from '@/src/components/ServerVideoEditor';

export default function Home() {
  return (
    <main className="min-h-screen p-4">
      <h1 className="text-3xl font-bold text-center mb-8">Rhythm Cut</h1>
      <ServerVideoEditor />
    </main>
  );
}
