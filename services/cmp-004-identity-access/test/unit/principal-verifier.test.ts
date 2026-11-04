import { describe, expect, it } from 'vitest';
import {
  IdentityPrincipalVerifier,
  IdentityContextResolver,
  type SessionDirectory,
  type SessionLookupRow,
} from '../../src/principal-verifier.js';

const dir: SessionDirectory = {
  async lookupByToken() {
    return null;
  },
};

const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function session(partial: Partial<SessionLookupRow> = {}): SessionLookupRow {
  return {
    session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actor_type: 'CITIZEN',
    subject_id: SUBJECT,
    tenant_id: null,
    assurance: 'OTP',
    status: 'ACTIVE',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    role_codes: [],
    ...partial,
  };
}

function bearer(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as never;
}

describe('PrincipalVerifier', () => {
  it('returns null without a bearer session', async () => {
    const v = new IdentityPrincipalVerifier(dir);
    await expect(v.verify({ headers: {} } as never)).resolves.toBeNull();
    await expect(v.verify({ headers: { authorization: 'Basic x' } } as never)).resolves.toBeNull();
    await expect(v.verify({ headers: { authorization: 'Bearer ' } } as never)).resolves.toBeNull();
  });

  it('resolves citizen and officer contexts from the presented token session', async () => {
    const byToken = new Map<string, SessionLookupRow>([
      ['citizen', session()],
      [
        'officer',
        session({
          actor_type: 'OFFICER',
          tenant_id: TENANT,
          assurance: 'MFA',
          role_codes: ['SERVICE_CHECKER'],
        }),
      ],
    ]);
    const live: SessionDirectory = {
      async lookupByToken(token) {
        return byToken.get(token) ?? null;
      },
    };
    const v = new IdentityPrincipalVerifier(live);
    await expect(v.verify(bearer('missing'))).resolves.toBeNull();
    const citizen = await v.verify(bearer('citizen'));
    const officer = await v.verify(bearer('officer'));
    const r = new IdentityContextResolver(live, 'cell-01');
    const citizenCtx = citizen ? await r.resolve(citizen, { cellId: '' }) : null;
    expect(citizenCtx?.actor.type).toBe('CITIZEN');
    expect(citizenCtx?.tenant_id).toBeNull();
    const officerCtx = officer ? await r.resolve(officer, { cellId: 'cell-02' }) : null;
    expect(officerCtx?.tenant_id).toBe(TENANT);
    expect(officerCtx?.roles).toEqual(['SERVICE_CHECKER']);
  });

  it('SEC F-01: two sessions of one officer in two tenants each resolve to their own tenant', async () => {
    const sessions = new Map<string, SessionLookupRow>([
      ['tenant-a', session({ actor_type: 'OFFICER', tenant_id: TENANT, role_codes: ['A_ROLE'] })],
      [
        'tenant-b',
        session({
          session_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          actor_type: 'OFFICER',
          tenant_id: TENANT_B,
          role_codes: ['B_ROLE'],
          expires_at: new Date('2099-06-01T00:00:00.000Z'),
        }),
      ],
    ]);
    const live: SessionDirectory = {
      async lookupByToken(presented) {
        return sessions.get(presented) ?? null;
      },
    };
    const v = new IdentityPrincipalVerifier(live);
    const r = new IdentityContextResolver(live, 'cell-01');
    const a = await v.verify(bearer('tenant-a'));
    const b = await v.verify(bearer('tenant-b'));
    expect(a && (await r.resolve(a, { cellId: '' }))).toMatchObject({
      tenant_id: TENANT,
      roles: ['A_ROLE'],
    });
    expect(b && (await r.resolve(b, { cellId: '' }))).toMatchObject({
      tenant_id: TENANT_B,
      roles: ['B_ROLE'],
    });
  });

  it('refuses a principal that did not come from the verifier', async () => {
    const r = new IdentityContextResolver(dir, 'cell-01');
    await expect(
      r.resolve({ subject_id: SUBJECT, actor_type: 'OFFICER', assurance: 'MFA' }, { cellId: '' }),
    ).resolves.toBeNull();
  });

  it('returns null for officer sessions without tenant, and for inactive bound sessions', async () => {
    let row = session({ actor_type: 'OFFICER', tenant_id: null });
    const live: SessionDirectory = {
      async lookupByToken() {
        return row;
      },
    };
    const v = new IdentityPrincipalVerifier(live);
    const r = new IdentityContextResolver(live, 'cell-01');
    const p = await v.verify(bearer('x'));
    expect(p && (await r.resolve(p, { cellId: '' }))).toBeNull();
    row = session({ status: 'REVOKED' });
    const revoked = await v.verify(bearer('y'));
    expect(revoked && (await r.resolve(revoked, { cellId: '' }))).toBeNull();
  });
});
