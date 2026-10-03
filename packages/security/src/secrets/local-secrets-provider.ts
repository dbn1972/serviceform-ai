import { readFile } from 'node:fs/promises';
import { realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  SECRET_NAME,
  SecretUnavailableError,
  assertLocalEnvironment,
  type SecretRef,
  type SecretsProvider,
} from './secrets-provider.js';
import { SecretValue } from './secret-value.js';

export class LocalSecretsProvider implements SecretsProvider {
  constructor(
    private readonly opts: {
      env?: NodeJS.ProcessEnv;
      mountDir?: string;
      maxStaleMs?: number;
    } = {},
  ) {
    assertLocalEnvironment(opts.env?.['SF_ENVIRONMENT'] ?? process.env['SF_ENVIRONMENT']);
  }

  async get(ref: SecretRef): Promise<SecretValue> {
    if (!SECRET_NAME.test(ref.name)) throw new SecretUnavailableError(ref.name);
    const env = this.opts.env ?? process.env;
    const fromEnv = env[`SF_SECRET_${ref.name}`];
    if (fromEnv) return SecretValue.fromString(fromEnv);
    if (this.opts.mountDir) {
      const value = await this.readMounted(ref.name);
      if (value) return value;
    }
    throw new SecretUnavailableError(ref.name);
  }

  private async readMounted(name: string): Promise<SecretValue | undefined> {
    const root = await realpath(resolve(this.opts.mountDir ?? ''));
    const candidate = resolve(join(root, name));
    if (!candidate.startsWith(root + sep) && candidate !== root) {
      throw new SecretUnavailableError(name);
    }
    let target: string;
    try {
      target = await realpath(candidate);
    } catch {
      return undefined;
    }
    if (!target.startsWith(root + sep) && target !== root) {
      throw new SecretUnavailableError(name);
    }
    const st = await stat(target);
    if (!st.isFile()) throw new SecretUnavailableError(name);
    const buf = await readFile(target);
    return new SecretValue(buf);
  }
}
