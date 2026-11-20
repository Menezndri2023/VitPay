import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { EnvBanner } from '@vitpay/ui';
import '@vitpay/ui/src/styles.css';
import { arabic, inter } from './fonts';

export const metadata: Metadata = {
  title: 'VITPAY Business',
  description: 'VITPAY — One platform. Every payment.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b3d2e' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${arabic.variable}`}>
      <body>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
