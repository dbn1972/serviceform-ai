import {
  assertStorageModeAllowed,
  parseDeploymentEnvironment,
  type StorageMode,
} from '@serviceform/storage';
import type { DeploymentEnvironment } from '@serviceform/contracts';

export interface StorageServiceConfig {
  environment: DeploymentEnvironment;
  storageMode: StorageMode;
  storageBindingId: string;
  kmsKeyRef: string;
  presignSecretName: string;
  presignTtlSeconds: number;
  testRunId: string;
  scenario: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StorageServiceConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const storageMode = (env['SF_STORAGE_MODE'] ?? 'SIMULATED') as string;
  assertStorageModeAllowed(storageMode, environment);
  const storageBindingId =
    env['SF_STORAGE_BINDING_ID'] ?? '03203203-2032-4032-8032-032032032032';
  const kmsKeyRef = env['SF_STORAGE_KMS_KEY_REF'] ?? 'local/storage-dek-wrap';
  const presignSecretName = env['SF_STORAGE_PRESIGN_SECRET'] ?? 'local/storage-presign';
  const presignTtlSeconds = Number(env['SF_STORAGE_PRESIGN_TTL_SECONDS'] ?? '300');
  const testRunId = env['SF_STORAGE_TEST_RUN_ID'] ?? 'cmp032-local';
  const scenario = env['SF_STORAGE_SCENARIO'] ?? 'store_success';
  return {
    environment,
    storageMode,
    storageBindingId,
    kmsKeyRef,
    presignSecretName,
    presignTtlSeconds: Number.isFinite(presignTtlSeconds) ? presignTtlSeconds : 300,
    testRunId,
    scenario,
  };
}
