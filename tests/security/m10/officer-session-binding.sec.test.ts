import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_DB,
  API,
  bffOfficer,
  call,
  cookieToken,
  db,
  LAB_OFFICER,
  OFFICER_BFF,
  officerOnHost,
  OTHER_TENANT,
  TENANT_A,
} from './lib/lab';

/**
 * The officer context must come from the session behind the presented bearer token only (F-01..F-03).
 * These probes seed further, legitimately-shaped sessions for the same officer (as IdP sign-ins in
 * this or another tenant would) with the admin login and observe what each token resolves to.
 */
let admin: Client;
const seeded: { tenant: string; session: string; hash: string }[] = [];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function seedSession(tenant: string, roles: string[], hoursAhead: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = sha(token);
  const session = randomUUID();
  const expires = new Date(Date.now() + hoursAhead * 3_600_000).toISOString();
  await admin.query(
    `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
     VALUES ($1, $2, $3, 'ACTIVE') ON CONFLICT (tenant_id, officer_id) DO NOTHING`,
    [tenant, LAB_OFFICER.officer_id, sha(`seed:${tenant}`)],
  );
  await admin.query(
    `INSERT INTO sf_identity.officer_session (tenant_id, session_id, officer_id, token_hash, status, assurance, role_codes, expires_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', 'MFA', $5, $6)`,
    [tenant, session, LAB_OFFICER.officer_id, hash, roles, expires],
  );
  await admin.query(
    `INSERT INTO sf_identity.session_lookup (token_hash, session_id, actor_type, subject_id, tenant_id, assurance, status, expires_at)
     VALUES ($1, $2, 'OFFICER', $3, $4, 'MFA', 'ACTIVE', $5)`,
    [hash, session, LAB_OFFICER.officer_id, tenant, expires],
  );
  seeded.push({ tenant, session, hash });
  return token;
}

async function revokeSeeded(): Promise<void> {
  for (const s of seeded.splice(0)) {
    await admin.query(
      "UPDATE sf_identity.session_lookup SET status = 'REVOKED' WHERE token_hash = $1",
      [s.hash],
    );
    await admin.query(
      "UPDATE sf_identity.officer_session SET status = 'REVOKED' WHERE tenant_id = $1 AND session_id = $2",
      [s.tenant, s.session],
    );
  }
}

beforeAll(async () => {
  admin = await db(ADMIN_DB);
});
afterAll(async () => {
  await revokeSeeded();
  await admin.end();
});

describe('SEC-SESSION-BINDING officer context comes from the presented session', () => {
  it('F-01: a tenant-A token keeps the tenant-A context when a later tenant-B session exists', async () => {
    const { token } = await officerOnHost();
    const before = await call(API, 'GET', '/v1/identity/me', { token });
    expect(before.body['tenant_id']).toBe(TENANT_A);
    await seedSession(OTHER_TENANT, [LAB_OFFICER.role], 12);
    const after = await call(API, 'GET', '/v1/identity/me', { token });
    // Expected (secure): still TENANT_A, because the presented token belongs to the tenant-A session.
    expect.soft(after.body['tenant_id'], 'context taken from a different session').toBe(TENANT_A);
    const queue = await call(API, 'GET', '/v1/applications', { token });
    expect.soft(queue.status, 'tenant-A token denied on tenant-A host').toBe(200);
    await revokeSeeded();
  });

  it('F-01: a credential issued for a tenant-B session gets no tenant-A context or cases', async () => {
    const tokenB = await seedSession(OTHER_TENANT, [LAB_OFFICER.role], 1);
    await officerOnHost();
    const after = await call(API, 'GET', '/v1/applications', { token: tokenB });
    const n = ((after.body['applications'] as unknown[] | undefined) ?? []).length;
    await revokeSeeded();
    // Expected (secure): 401, the tenant-B session must never yield a tenant-A context.
    expect.soft(after.status, 'tenant-B credential accepted for tenant-A list').toBe(401);
    expect.soft(n, 'tenant-A cases returned to a tenant-B credential').toBe(0);
  });

  it('F-02: signing out with the tenant-A token revokes it while a later tenant-B session exists', async () => {
    const { token } = await officerOnHost();
    const hash = sha(token);
    await seedSession(OTHER_TENANT, [LAB_OFFICER.role], 12);
    const revoke = await call(API, 'POST', '/v1/identity/officer/sessions/revoke', {
      token,
      body: {},
    });
    const row = await admin.query<{ status: string }>(
      'SELECT status FROM sf_identity.session_lookup WHERE token_hash = $1',
      [hash],
    );
    await revokeSeeded();
    const reuse = await call(API, 'GET', '/v1/applications', { token });
    // Expected (secure): revoke succeeds and the presented session is REVOKED and unusable.
    expect.soft(revoke.status, 'revoke response').toBe(200);
    expect.soft(row.rows[0]?.status, 'presented session status after revoke').toBe('REVOKED');
    expect.soft(reuse.status, 'token reusable after sign-out').toBe(401);
  });

  it('F-03: roles come from the presented session, not a later same-tenant session', async () => {
    const { token } = await officerOnHost();
    // A later session in the same tenant that carries no roles (e.g. a role removal at the IdP).
    await seedSession(TENANT_A, [], 12);
    const queue = await call(API, 'GET', '/v1/applications', { token });
    await revokeSeeded();
    // Expected (secure): the presented session still has SAMPLE_LAB_CASE_OFFICER and lists (200).
    expect.soft(queue.status, 'presented session roles replaced by another session').toBe(200);
  });

  it('F-05: a DISABLED officer is not re-activated by sign-in and live sessions stop', async () => {
    const first = await officerOnHost();
    expect(first.res.status).toBe(200);
    await admin.query(
      "UPDATE sf_identity.officer_principal SET status = 'DISABLED' WHERE tenant_id = $1 AND officer_id = $2",
      [TENANT_A, LAB_OFFICER.officer_id],
    );
    const live = await call(API, 'GET', '/v1/applications', { token: first.token });
    const again = await officerOnHost();
    const st = await admin.query<{ status: string }>(
      'SELECT status FROM sf_identity.officer_principal WHERE tenant_id = $1 AND officer_id = $2',
      [TENANT_A, LAB_OFFICER.officer_id],
    );
    await admin.query(
      "UPDATE sf_identity.officer_principal SET status = 'ACTIVE' WHERE tenant_id = $1 AND officer_id = $2",
      [TENANT_A, LAB_OFFICER.officer_id],
    );
    expect.soft(live.status, 'existing session of a disabled officer').toBe(401);
    expect.soft(again.res.status, 'new session for a disabled officer').not.toBe(200);
    expect.soft(st.rows[0]?.status, 'principal status after sign-in').toBe('DISABLED');
  });

  it('F-01/F-02/F-03 with three sessions: each token gets exactly its own tenant and roles; sign-out revokes the presented tenant only', async () => {
    const t1 = (await officerOnHost()).token;
    const t2 = await seedSession(TENANT_A, [], 20);
    const t3 = await seedSession(OTHER_TENANT, [LAB_OFFICER.role], 24);
    const me1 = await call(API, 'GET', '/v1/identity/me', { token: t1 });
    const me3 = await call(API, 'GET', '/v1/identity/me', { token: t3 });
    expect(me1.body['tenant_id']).toBe(TENANT_A);
    expect(me3.body['tenant_id']).toBe(OTHER_TENANT);
    expect((await call(API, 'GET', '/v1/applications', { token: t1 })).status).toBe(200);
    expect((await call(API, 'GET', '/v1/applications', { token: t2 })).status).toBe(403);
    expect((await call(API, 'GET', '/v1/applications', { token: t3 })).status).toBe(401);
    const revoke = await call(API, 'POST', '/v1/identity/officer/sessions/revoke', {
      token: t1,
      body: {},
    });
    expect(revoke.status).toBe(200);
    const st = await admin.query<{ token_hash: string; status: string }>(
      'SELECT token_hash, status FROM sf_identity.session_lookup WHERE token_hash = ANY($1)',
      [[sha(t1), sha(t2), sha(t3)]],
    );
    const by = Object.fromEntries(st.rows.map((r) => [r.token_hash, r.status]));
    expect(by[sha(t1)]).toBe('REVOKED');
    expect(by[sha(t2)]).toBe('REVOKED');
    expect(by[sha(t3)], 'other-tenant session untouched by tenant-A sign-out').toBe('ACTIVE');
    for (const t of [t1, t2]) {
      expect((await call(API, 'GET', '/v1/applications', { token: t })).status).toBe(401);
      expect((await call(API, 'GET', '/v1/identity/me', { token: t })).status).toBe(401);
    }
    expect((await call(API, 'GET', '/v1/applications', { token: t3 })).status).toBe(401);
    await revokeSeeded();
  });

  it('F-05 across tenants: disabling the tenant-B principal does not affect tenant A; disabling A stops A and never yields B', async () => {
    const t1 = (await officerOnHost()).token;
    const t3 = await seedSession(OTHER_TENANT, [LAB_OFFICER.role], 24);
    const setStatus = (tenant: string, status: string) =>
      admin.query(
        'UPDATE sf_identity.officer_principal SET status = $3 WHERE tenant_id = $1 AND officer_id = $2',
        [tenant, LAB_OFFICER.officer_id, status],
      );
    try {
      await setStatus(OTHER_TENANT, 'DISABLED');
      expect((await call(API, 'GET', '/v1/applications', { token: t1 })).status).toBe(200);
      expect((await call(API, 'GET', '/v1/identity/me', { token: t3 })).status).toBe(401);
      await setStatus(OTHER_TENANT, 'ACTIVE');
      await setStatus(TENANT_A, 'DISABLED');
      expect((await call(API, 'GET', '/v1/applications', { token: t1 })).status).toBe(401);
      expect((await call(API, 'GET', '/v1/applications', { token: t3 })).status).toBe(401);
      const me3 = await call(API, 'GET', '/v1/identity/me', { token: t3 });
      expect(me3.body['tenant_id']).toBe(OTHER_TENANT);
      const fresh = await officerOnHost();
      expect(fresh.res.status).not.toBe(200);
      expect(fresh.token).toBe('');
    } finally {
      await setStatus(TENANT_A, 'ACTIVE');
      await setStatus(OTHER_TENANT, 'ACTIVE');
      await revokeSeeded();
    }
  });

  it('inconsistent or stale rows never resolve: expired lookup, revoked officer_session behind an ACTIVE lookup', async () => {
    const expired = await seedSession(TENANT_A, [LAB_OFFICER.role], -1);
    expect((await call(API, 'GET', '/v1/applications', { token: expired })).status).toBe(401);
    const t = await seedSession(TENANT_A, [LAB_OFFICER.role], 4);
    expect((await call(API, 'GET', '/v1/applications', { token: t })).status).toBe(200);
    const last = seeded[seeded.length - 1] as { tenant: string; session: string };
    await admin.query(
      "UPDATE sf_identity.officer_session SET status = 'REVOKED' WHERE tenant_id = $1 AND session_id = $2",
      [last.tenant, last.session],
    );
    expect((await call(API, 'GET', '/v1/applications', { token: t })).status).toBe(401);
    expect((await call(API, 'GET', '/v1/identity/me', { token: t })).status).toBe(401);
    await revokeSeeded();
  });

  it('officer BFF sign-out revokes the presented session on the platform', async () => {
    const o = await bffOfficer();
    const token = cookieToken(o.cookie);
    await seedSession(OTHER_TENANT, [LAB_OFFICER.role], 24);
    expect(
      (await call(OFFICER_BFF, 'DELETE', '/api/portal/session', { cookie: o.cookie })).status,
    ).toBe(204);
    const row = await admin.query<{ status: string }>(
      'SELECT status FROM sf_identity.session_lookup WHERE token_hash = $1',
      [sha(token)],
    );
    await revokeSeeded();
    expect(row.rows[0]?.status).toBe('REVOKED');
    expect((await call(API, 'GET', '/v1/applications', { token })).status).toBe(401);
  });

  it('N-1: a role-less officer session can still sign itself out', async () => {
    const t = await seedSession(TENANT_A, [], 4);
    const r = await call(API, 'POST', '/v1/identity/officer/sessions/revoke', {
      token: t,
      body: {},
    });
    const row = await admin.query<{ status: string }>(
      'SELECT status FROM sf_identity.session_lookup WHERE token_hash = $1',
      [sha(t)],
    );
    await revokeSeeded();
    expect.soft(r.status, 'role-less revoke status').toBe(200);
    expect.soft(row.rows[0]?.status, 'role-less session after revoke').toBe('REVOKED');
  });
});
