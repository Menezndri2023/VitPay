import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  // Le kit et l'exemple SaaS sont testés depuis leurs sources (pas besoin de compiler le kit).
  resolve: { alias: { '@vitpay/node': resolve(__dirname, '../../packages/sdk-node/src/index.ts') } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['reflect-metadata'],
    // Les tests d'intégration partagent une base : exécution séquentielle des fichiers.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
