import { defineConfig } from '@playwright/test';

/**
 * Vidéos de démonstration narrées (voir demo/README.md) : mêmes parcours que la suite,
 * ralentis, sous-titrés, filmés en 1280×720. Voix off ajoutée ensuite par demo/assemble.sh.
 */
export default defineConfig({
  testDir: './demo',
  globalSetup: './global-setup.ts',
  timeout: 5 * 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: true,
    locale: 'fr-FR',
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    launchOptions: { slowMo: 150 },
  },
  outputDir: process.env.PW_OUTPUT ?? 'test-results/demo',
});
