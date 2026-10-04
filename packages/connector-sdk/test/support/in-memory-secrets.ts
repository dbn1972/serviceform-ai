import type { SecretResolver } from '../../src/secrets.js';
import { SecretMaterial } from '../../src/secrets.js';

export class InMemorySecretResolver implements SecretResolver {
  readonly #secrets = new Map<string, string>();

  put(ref: string, value: string): void {
    this.#secrets.set(ref, value);
  }

  async resolve(secretRef: string): Promise<SecretMaterial> {
    const value = this.#secrets.get(secretRef);
    if (value === undefined) throw new Error('secret_not_found');
    return new SecretMaterial(value);
  }
}
