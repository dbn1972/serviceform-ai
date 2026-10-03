import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke + accessibility checks for the Next.js shells (TESTING.md "Accessibility checks",
 * DESIGN-SYSTEM.md rule 6). Apps must be built first: pnpm -r --filter "./apps/web-*" run build.
 * PW_CHROMIUM_PATH lets sandboxed environments reuse a preinstalled Chromium.
 */
export const SURFACES = [
  { app: 'web-citizen', port: 3000, title: 'Citizen Portal', surface: 'citizen_web' },
  { app: 'web-officer', port: 3001, title: 'Officer Workbench', surface: 'officer_workbench' },
  { app: 'web-studio', port: 3002, title: 'Service Design Studio', surface: 'service_studio' },
  { app: 'web-admin', port: 3003, title: 'Administration', surface: 'tenant_admin' },
] as const;

const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: '../../test-results/e2e/junit.xml' }],
    ['json', { outputFile: '../../test-results/e2e/results.json' }],
  ],
  outputDir: '../../test-results/e2e/artifacts',
  use: {
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: SURFACES.map((s) => ({
    command: `pnpm --filter @serviceform/${s.app} start`,
    url: `http://127.0.0.1:${s.port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1' },
  })),
});
