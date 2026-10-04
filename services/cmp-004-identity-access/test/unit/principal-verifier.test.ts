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
  async lookupActiveBySubject() {
    return null;
  },
};

const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = '11111111-1111-4111-8111-111111111111';

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

describe('PrincipalVerifier', () => {
  it('returns null without a bearer session', async () => {
    const v = new IdentityPrincipalVerifier(dir);
    await expect(v.verify({ headers: {} } as never)).resolves.toBeNull();
    await expect(v.verify({ headers: { authorization: 'Basic x' } } as never)).resolves.toBeNull();
    await expect(v.verify({ headers: { authorization: 'Bearer ' } } as never)).resolves.toBeNull();
    const r = new IdentityContextResolver(dir, 'cell-01');
    await expect(
      r.resolve(
        {
          subject_id: SUBJECT,
          actor_type: 'CITIZEN',
          assurance: 'OTP',
        },
        { cellId: 'cell-01' },
      ),
    ).resolves.toBeNull();
  });

  it('resolves citizen and officer sessions from the directory', async () => {
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
      async lookupActiveBySubject(principal) {
        if (principal.actor_type === 'CITIZEN') return session();
        if (principal.actor_type === 'OFFICER' && principal.subject_id === SUBJECT) {
          return session({
            actor_type: 'OFFICER',
            tenant_id: TENANT,
            role_codes: ['SERVICE_CHECKER'],
          });
        }
        return null;
      },
    };
    const v = new IdentityPrincipalVerifier(live);
    await expect(
      v.verify({ headers: { authorization: 'Bearer missing' } } as never),
    ).resolves.toBeNull();
    const citizen = await v.verify({ headers: { authorization: 'Bearer citizen' } } as never);
    expect(citizen?.actor_type).toBe('CITIZEN');
    const officer = await v.verify({ headers: { authorization: 'Bearer officer' } } as never);
    expect(officer?.actor_type).toBe('OFFICER');

    const r = new IdentityContextResolver(live, 'cell-01');
    const citizenCtx = await r.resolve(
      { subject_id: SUBJECT, actor_type: 'CITIZEN', assurance: 'OTP' },
      { cellId: '' },
    );
    expect(citizenCtx?.actor.type).toBe('CITIZEN');
    expect(citizenCtx?.tenant_id).toBeNull();
    const officerCtx = await r.resolve(
      { subject_id: SUBJECT, actor_type: 'OFFICER', assurance: 'MFA' },
      { cellId: 'cell-02' },
    );
    expect(officerCtx?.tenant_id).toBe(TENANT);
    expect(officerCtx?.roles).toEqual(['SERVICE_CHECKER']);
  });

  it('returns null for officer sessions without tenant', async () => {
    const live: SessionDirectory = {
      async lookupByToken() {
        return session({ actor_type: 'OFFICER', tenant_id: null });
      },
      async lookupActiveBySubject() {
        return session({ actor_type: 'OFFICER', tenant_id: null });
      },
    };
    const r = new IdentityContextResolver(live, 'cell-01');
    await expect(
      r.resolve(
        { subject_id: SUBJECT, actor_type: 'OFFICER', assurance: 'MFA' },
        { cellId: 'cell-01' },
      ),
    ).resolves.toBeNull();
  });
});
