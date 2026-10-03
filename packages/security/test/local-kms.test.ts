import { describe, expect, it } from 'vitest';
import { LocalKms } from '../src/kms/local-kms.js';
import { LocalSecretsProvider } from '../src/secrets/local-secrets-provider.js';
import { T1, T2 } from './helpers/fakes.js';

describe('LocalKms (002-27 S3-S5, 002-29)', () => {
  const env = { SF_ENVIRONMENT: 'CI', SF_SECRET_KEK: 'x'.repeat(32) };

  it('round-trips and fails closed on tenant AAD mismatch / tamper', async () => {
    process.env['SF_ENVIRONMENT'] = 'CI';
    const secrets = new LocalSecretsProvider({ env });
    const kms = new LocalKms(secrets);
    const pt = new TextEncoder().encode('payload');
    const envl = await kms.encrypt('KEK', pt, { tenant_id: T1 });
    const back = await kms.decrypt(envl, { tenant_id: T1 });
    expect(new TextDecoder().decode(back)).toBe('payload');
    await expect(kms.decrypt(envl, { tenant_id: T2 })).rejects.toThrow();
    const raw = Buffer.from(envl.ciphertext, 'base64');
    raw.writeUInt8(raw.readUInt8(0) ^ 0xff, 0);
    const tampered = { ...envl, ciphertext: raw.toString('base64') };
    await expect(kms.decrypt(tampered, { tenant_id: T1 })).rejects.toThrow();
    const swapped = { ...envl, key_ref: 'MISSING' };
    await expect(kms.decrypt(swapped, { tenant_id: T1 })).rejects.toThrow();
  });

  it('IVs do not repeat across many encryptions', async () => {
    process.env['SF_ENVIRONMENT'] = 'CI';
    const secrets = new LocalSecretsProvider({ env });
    const kms = new LocalKms(secrets);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const e = await kms.encrypt('KEK', new Uint8Array([1]), { tenant_id: T1 });
      expect(seen.has(e.iv)).toBe(false);
      seen.add(e.iv);
    }
  });
});
