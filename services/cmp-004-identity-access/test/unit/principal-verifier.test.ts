import { describe, expect, it } from 'vitest';
import {
  IdentityPrincipalVerifier,
  IdentityContextResolver,
  type SessionDirectory,
} from '../../src/principal-verifier.js';

const dir: SessionDirectory = {
  async lookupByToken() {
    return null;
  },
  async lookupActiveBySubject() {
    return null;
  },
};

describe('PrincipalVerifier', () => {
  it('returns null without a bearer session', async () => {
    const v = new IdentityPrincipalVerifier(dir);
    await expect(v.verify({ headers: {} } as never)).resolves.toBeNull();
    await expect(v.verify({ headers: { authorization: 'Basic x' } } as never)).resolves.toBeNull();
    const r = new IdentityContextResolver(dir, 'cell-01');
    await expect(
      r.resolve(
        {
          subject_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          actor_type: 'CITIZEN',
          assurance: 'OTP',
        },
        { cellId: 'cell-01' },
      ),
    ).resolves.toBeNull();
  });
});
