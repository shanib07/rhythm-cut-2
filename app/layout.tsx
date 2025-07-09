import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from 'sonner';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rhythm Cut - Beat-Synchronized Video Editor",
  description: "Automatically cut and edit videos to the beat of your music",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster 
          position="bottom-right" 
          toastOptions={{
            style: {
              color: '#000000',
              backgroundColor: '#ffffff',
              border: '2px solid #374151',
              fontSize: '14px',
              fontWeight: '600',
              padding: '16px 20px',
              borderRadius: '12px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
              minHeight: '56px',
              zIndex: 9999
            },
            className: 'custom-toast'
          }}
        />
      </body>
    </html>
  );
}
