import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DiagramGen — יצירת דיאגרמות בינה מלאכותית',
  description: 'יוצר דיאגרמות זרימה מקצועיות בעברית בסגנון ספרי לימוד משפטיים',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0d1117',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-heebo antialiased">{children}</body>
    </html>
  );
}
