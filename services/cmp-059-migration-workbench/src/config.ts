import type { DeploymentEnvironment } from '@serviceform/contracts';
import { Cmp059Error } from './errors.js';

const ALLOWED_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
] as const;

export function parseDeploymentEnvironment(raw: string | undefined): DeploymentEnvironment {
  const value = raw === undefined || raw.length === 0 ? 'LOCAL' : raw;
  if (!(ALLOWED_ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new Cmp059Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface MigrationConfig {
  environment: DeploymentEnvironment;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  /** dry_run_required_before_execute is always true (architecture constraint §39) */
  dryRunRequiredBeforeExecute: true;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MigrationConfig {
  return {
    environment: parseDeploymentEnvironment(env['SF_ENVIRONMENT']),
    rateLimitMax: positiveInt(env['SF_CMP059_RATE_LIMIT_MAX'], 60),
    rateLimitWindowMs: positiveInt(env['SF_CMP059_RATE_LIMIT_WINDOW_MS'], 60_000),
    dryRunRequiredBeforeExecute: true,
  };
}
