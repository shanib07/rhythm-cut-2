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
              color: '#000000 !important',
              backgroundColor: '#ffffff !important',
              border: '1px solid #e5e7eb !important',
              fontSize: '14px !important',
              fontWeight: '500 !important',
              padding: '12px 16px !important',
              borderRadius: '8px !important',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15) !important'
            },
            className: 'custom-toast'
          }}
        />
      </body>
    </html>
  );
}
