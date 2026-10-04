import type { StorageSecretsPort } from '@serviceform/storage';
import { Cmp032Error } from '../errors.js';

export type { StorageSecretsPort };

export class LocalHmacSecrets implements StorageSecretsPort {
  private readonly key: Uint8Array;
  private readonly fail: boolean;

  constructor(opts: { key?: Uint8Array; fail?: boolean } = {}) {
    this.key = opts.key ?? new TextEncoder().encode('0123456789abcdef0123456789abcdef');
    this.fail = opts.fail === true;
  }

  async getHmacKey(_name: string): Promise<Uint8Array> {
    if (this.fail) throw new Error('secret unavailable');
    return Uint8Array.from(this.key);
  }
}

export async function requireHmacKey(
  secrets: StorageSecretsPort,
  name: string,
): Promise<Uint8Array> {
  try {
    return await secrets.getHmacKey(name);
  } catch (err) {
    throw new Cmp032Error('SF-SYS-004', {
      details: [{ code: 'SECRET_UNAVAILABLE' }],
      cause: err,
    });
  }
}
