import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@vitpay/ui/src/styles.css';

export const metadata: Metadata = {
  title: 'VITPAY Business',
  description: 'VITPAY — One platform. Every payment.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#071a3d' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
