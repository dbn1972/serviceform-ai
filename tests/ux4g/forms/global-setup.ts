import { spawnSync } from 'node:child_process';
import { ROOT } from './scenes-dir';

/** Pre-renders the gallery scenes to static HTML under Vitest before any spec runs. */
export default function globalSetup(): void {
  const run = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'tests/ux4g/forms/vitest.config.ts'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    },
  );
  if (run.status !== 0) throw new Error(`UX4G gallery render failed (exit ${run.status})`);
}
