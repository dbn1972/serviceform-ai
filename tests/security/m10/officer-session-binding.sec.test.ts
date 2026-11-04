import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_DB,
  API,
  call,
  db,
  LAB_OFFICER,
  officerOnHost,
  OTHER_TENANT,
  TENANT_A,
} from './lib/lab';

/**
 * CMP-004 IdentityContextResolver resolves the officer context from the subject's latest ACTIVE
 * session, not from the session behind the presented bearer token. These probes seed a second,
 * legitimately-shaped session for the same officer (as an IdP sign-in in another tenant would)
 * with the admin login and observe what the first token resolves to.
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
  it('FINDING: token for a tenant-A session resolves to the later tenant-B session context', async () => {
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

  it('FINDING: a credential issued for a tenant-B session reads tenant-A cases on the tenant-A host', async () => {
    const tokenB = await seedSession(OTHER_TENANT, [LAB_OFFICER.role], 1);
    await officerOnHost();
    const after = await call(API, 'GET', '/v1/applications', { token: tokenB });
    const n = ((after.body['applications'] as unknown[] | undefined) ?? []).length;
    await revokeSeeded();
    // Expected (secure): 401, the tenant-B session must never yield a tenant-A context.
    expect.soft(after.status, 'tenant-B credential accepted for tenant-A list').toBe(401);
    expect.soft(n, 'tenant-A cases returned to a tenant-B credential').toBe(0);
  });

  it('FINDING: signing out with the tenant-A token does not revoke the tenant-A session while a later session exists', async () => {
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

  it('FINDING: roles come from the latest same-tenant session, not the presented one', async () => {
    const { token } = await officerOnHost();
    // A later session in the same tenant that carries no roles (e.g. a role removal at the IdP).
    await seedSession(TENANT_A, [], 12);
    const queue = await call(API, 'GET', '/v1/applications', { token });
    await revokeSeeded();
    // Expected (secure): the presented session still has SAMPLE_LAB_CASE_OFFICER and lists (200).
    expect.soft(queue.status, 'presented session roles replaced by another session').toBe(200);
  });

  it('FINDING: a DISABLED officer principal is re-activated by the next IdP sign-in', async () => {
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
});
