import type { MetadataRoute } from 'next';

/** Application installable (téléphone, tablette de caisse) : icône sur l'écran d'accueil, plein écran. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VITPAY Business',
    short_name: 'VITPAY',
    description: 'Encaissez vos clients par lien, QR code ou TPE.',
    lang: 'fr',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f8f7',
    theme_color: '#0b3d2e',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Caisse', url: '/app/pos', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'Nouvelle demande', url: '/app/requests/new', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
