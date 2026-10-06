import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Farlands · Event control',
  description: 'Farlands participant registration and venue monitoring',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
