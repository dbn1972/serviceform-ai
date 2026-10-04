import type { SecretValue } from './secret-value.js';

export interface SecretRef {
  provider: string;
  name: string;
  version?: string;
}

export class SecretUnavailableError extends Error {
  constructor(readonly refName: string) {
    super(`secret unavailable: ${refName}`);
    this.name = 'SecretUnavailableError';
  }
}

export interface SecretsProvider {
  get(ref: SecretRef): Promise<SecretValue>;
}

const LOCAL_ENVS = new Set(['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE']);

export function assertLocalEnvironment(env = process.env['SF_ENVIRONMENT']): void {
  if (!env || !LOCAL_ENVS.has(env)) {
    throw new Error(
      'LocalSecretsProvider/LocalKms refused outside LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE',
    );
  }
}

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
