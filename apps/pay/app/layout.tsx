import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { EnvBanner } from '@vitpay/ui';
import '@vitpay/ui/src/styles.css';

export const metadata: Metadata = {
  title: 'VITPAY — Paiement',
  description: 'VITPAY — One platform. Every payment.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b2a5b' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
