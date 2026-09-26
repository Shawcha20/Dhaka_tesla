import type { Metadata, Viewport } from 'next';

import { AppProviders } from '@/providers/app-providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Dhaka Tesla Pool',
    template: '%s · Dhaka Tesla Pool',
  },
  description: 'Share a seat. Split the fare. Survive Dhaka traffic.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Most riders will be on a phone at a roadside, so the layout is built
  // mobile-first and the safe-area insets matter.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
