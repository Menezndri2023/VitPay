import { defineConfig } from '@playwright/test';

/**
 * Tests navigateur de bout en bout. Prérequis : API (4710), Pay (3710), Business (3711) et
 * Admin (3712) démarrés en mode sandbox (voir README).
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    // Chrome installé sur le poste ; en CI : `npx playwright install chromium` et retirer `channel`.
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: true,
    locale: 'fr-FR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: process.env.PW_OUTPUT ?? 'test-results',
});
