import type { Metadata, Viewport } from 'next';
import { Mitr, Sarabun } from 'next/font/google';
import { baseUrl } from '@/lib/http';
import './globals.css';

const sarabun = Sarabun({ subsets: ['thai', 'latin'], weight: ['400', '500', '700'], variable: '--font-sarabun', display: 'swap' });
const mitr = Mitr({ subsets: ['thai', 'latin'], weight: ['400', '500'], variable: '--font-mitr', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: { default: 'มรดกเสียง — เล่าให้หลานฟัง', template: '%s · มรดกเสียง' },
  description: 'เก็บเรื่องเล่าชีวิตด้วยเสียงจริงของคุณตาคุณยาย ผ่านการสัมภาษณ์ที่หลานเป็นคนถาม',
  openGraph: { title: 'มรดกเสียง — เล่าให้หลานฟัง', images: [{ url: '/art/og.jpg', width: 1200, height: 630 }], locale: 'th_TH', type: 'website' },
};

export const viewport: Viewport = { themeColor: '#fbf5ea', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${sarabun.variable} ${mitr.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
