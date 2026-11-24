/**
 * UX4G forms-surface harness: accessibility, keyboard, reflow/resize/text-spacing, forced colours,
 * token lock and visual regression over the shared form renderer gallery
 * (packages/ui-ux4g/gallery), pre-rendered to static HTML by global-setup.ts. Needs no platform
 * host or app build.
 *
 * Baselines are owned by the reference environment: Ubuntu 24.04, fonts-noto-core and
 * Playwright's bundled Chromium. PW_CHROMIUM_PATH is deliberately not honoured here.
 * Not CERTIFIED; does not set SF_M10_UX4G_READY.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: '../../../test-results/ux4g/forms/junit.xml' }],
    ['json', { outputFile: '../../../test-results/ux4g/forms/results.json' }],
    ['html', { outputFolder: '../../../test-results/ux4g/forms/html', open: 'never' }],
  ],
  outputDir: '../../../test-results/ux4g/forms/artifacts',
  snapshotDir: './snapshots',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
});
