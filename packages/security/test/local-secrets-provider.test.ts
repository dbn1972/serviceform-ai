import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalSecretsProvider } from '../src/secrets/local-secrets-provider.js';
import { SecretUnavailableError } from '../src/secrets/secrets-provider.js';
import { SYNTHETIC_WRAP_KEY } from './helpers/synthetic-wrap-key.js';

describe('LocalSecretsProvider (002-28)', () => {
  it('reads SF_SECRET_* and refuses bad env/names/paths', async () => {
    const p = new LocalSecretsProvider({
      env: { SF_ENVIRONMENT: 'CI', SF_SECRET_WRAP: SYNTHETIC_WRAP_KEY },
    });
    const v = await p.get({ provider: 'local', name: 'WRAP' });
    expect(v.revealText()).toHaveLength(32);
    v.dispose();
    await expect(p.get({ provider: 'local', name: '../etc/passwd' })).rejects.toBeInstanceOf(
      SecretUnavailableError,
    );
    expect(() => new LocalSecretsProvider({ env: { SF_ENVIRONMENT: 'PRODUCTION' } })).toThrow(
      /refused/,
    );
    expect(() => new LocalSecretsProvider({ env: { SF_ENVIRONMENT: '' } })).toThrow(/refused/);
  });

  it('refuses symlink escape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-sec-'));
    await symlink('/etc/passwd', join(dir, 'WRAPKEY'));
    const p = new LocalSecretsProvider({ env: { SF_ENVIRONMENT: 'CI' }, mountDir: dir });
    await expect(p.get({ provider: 'local', name: 'WRAPKEY' })).rejects.toBeInstanceOf(
      SecretUnavailableError,
    );
    await writeFile(join(dir, 'OKKEY'), SYNTHETIC_WRAP_KEY);
    const v = await p.get({ provider: 'local', name: 'OKKEY' });
    expect(v.reveal().length).toBeGreaterThan(0);
    v.dispose();
  });
});
