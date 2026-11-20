import { Inter, Noto_Sans_Arabic } from 'next/font/google';

// Polices téléchargées À LA CONSTRUCTION et servies par l'app elle-même : aucune requête
// du navigateur vers Google (pas de fuite d'adresse IP des payeurs ou commerçants).
export const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--vp-font-latin' });
export const arabic = Noto_Sans_Arabic({ subsets: ['arabic'], display: 'swap', variable: '--vp-font-arabic', weight: ['400', '500', '600', '700'] });
