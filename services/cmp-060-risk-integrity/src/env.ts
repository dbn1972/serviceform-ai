/** Environments that must refuse SIMULATED ports (Architecture Constitution mode rules). */
const BLOCKED = new Set(['PRODUCTION', 'UAT', 'PREPROD']);

export function currentSfEnvironment(): string {
  return (process.env['SF_ENVIRONMENT'] ?? 'LOCAL').toUpperCase();
}

export function refuseSimulatedOutsideLab(label: string): void {
  const env = currentSfEnvironment();
  if (BLOCKED.has(env)) {
    throw new Error(`SF-SYS-003: ${label} SIMULATED port refused in ${env}`);
  }
}
