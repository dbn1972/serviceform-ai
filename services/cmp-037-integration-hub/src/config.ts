import type { DeploymentEnvironment } from '@serviceform/contracts';
import { parseDeploymentEnvironment } from '@serviceform/connector-sdk';

export interface HubConfig {
  environment: DeploymentEnvironment;
  cellId: string;
  webhookMaxBytes: number;
  webhookReplayWindowSeconds: number;
  webhookRateLimit: number;
  webhookRateWindowMs: number;
}

export function loadHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT']);
  const cellId = env['SF_CELL_ID'];
  if (!cellId || !/^cell-[a-z0-9-]{1,40}$/.test(cellId)) {
    throw new Error('Invalid configuration for: SF_CELL_ID');
  }
  return {
    environment,
    cellId,
    webhookMaxBytes: 65_536,
    webhookReplayWindowSeconds: 300,
    webhookRateLimit: 60,
    webhookRateWindowMs: 60_000,
  };
}
