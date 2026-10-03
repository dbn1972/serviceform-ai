import type { DeploymentEnvironment } from '@serviceform/contracts';

export interface EventBusConfig {
  environment: string;
  databaseUrl: string;
  kafkaBrokers: string[];
  workerId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EventBusConfig {
  const brokers = (env['SF_KAFKA_BROKERS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    environment: env['SF_ENVIRONMENT'] ?? '',
    databaseUrl: env['DATABASE_URL'] ?? '',
    kafkaBrokers: brokers,
    workerId: env['SF_OUTBOX_WORKER_ID'] ?? 'cmp038-relay',
  };
}

export function isSimulatedAllowed(environment: string): environment is DeploymentEnvironment {
  return (
    environment === 'LOCAL' ||
    environment === 'CI' ||
    environment === 'DEVELOPMENT' ||
    environment === 'SIT' ||
    environment === 'PERFORMANCE'
  );
}
