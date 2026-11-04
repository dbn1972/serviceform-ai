/**
 * SF-M10-005 UX4G evidence Playwright config.
 * Independent a11y/keyboard/responsive/visual pack for the IND-SOC-002 journey.
 * Not CERTIFIED. Does not set SF_M10_UX4G_READY.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const API_BASE_URL = process.env['SF_API_BASE_URL'] ?? 'http://127.0.0.1:4000';
const PORTAL_ENV = {
  SF_API_BASE_URL: API_BASE_URL,
  SF_ENVIRONMENT: process.env['SF_ENVIRONMENT'] ?? 'LOCAL',
  SF_PORTAL_PLACEMENT_FILE:
    process.env['SF_PORTAL_PLACEMENT_FILE'] ??
    join(ROOT, 'fixtures/lab/platform/placement.citizen.json'),
  NEXT_TELEMETRY_DISABLED: '1',
  HOSTNAME: '127.0.0.1',
};

const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: '.',
  testMatch: ['**/ux4g-journey.spec.ts'],
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: '../../../test-results/ux4g/m10/junit.xml' }],
    ['json', { outputFile: '../../../test-results/ux4g/m10/results.json' }],
    ['html', { outputFolder: '../../../test-results/ux4g/m10/html', open: 'never' }],
  ],
  outputDir: '../../../test-results/ux4g/m10/artifacts',
  snapshotDir: './snapshots',
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: [
    {
      command: 'pnpm --filter @serviceform/web-citizen start',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: PORTAL_ENV,
    },
    {
      command: 'pnpm --filter @serviceform/web-officer start',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: PORTAL_ENV,
    },
  ],
});
