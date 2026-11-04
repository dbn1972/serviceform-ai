import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintSimulatedIdpAssertion } from '../../src/adapters/idp.js';
import {
  IdentityContextResolver,
  IdentityPrincipalVerifier,
  PgSessionDirectory,
} from '../../src/principal-verifier.js';
import { buildApp, closeHarness, PEPPER, setupHarness, T1, T2, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

type App = Awaited<ReturnType<typeof buildApp>>['app'];

async function officerToken(app: App, officerId: string, tenant: string, roles: string[]) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/identity/officer/sessions',
    payload: {
      assertion: mintSimulatedIdpAssertion(PEPPER, {
        sub: `officer-${officerId}`,
        tenant_id: tenant,
        officer_id: officerId,
        roles,
      }),
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  return {
    status: res.statusCode,
    token: (res.json() as { session_token?: string }).session_token,
  };
}

async function contextFor(token: string) {
  const directory = new PgSessionDirectory(h.rt);
  const principal = await new IdentityPrincipalVerifier(directory).verify({
    headers: { authorization: `Bearer ${token}` },
  } as never);
  if (!principal) return null;
  return new IdentityContextResolver(directory, 'cell-01').resolve(principal, {
    cellId: 'cell-01',
  });
}

describe('CMP-004 context is bound to the presented session (SEC F-01/F-02/F-03/F-05)', () => {
  it('one officer with sessions in two tenants resolves each token to its own tenant and roles', async () => {
    const { app } = await buildApp(h);
    const officer = randomUUID();
    const a = await officerToken(app, officer, T1, ['ROLE_IN_T1']);
    const b = await officerToken(app, officer, T2, ['ROLE_IN_T2']);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await contextFor(a.token ?? '')).toMatchObject({ tenant_id: T1, roles: ['ROLE_IN_T1'] });
    expect(await contextFor(b.token ?? '')).toMatchObject({ tenant_id: T2, roles: ['ROLE_IN_T2'] });
    const me = await app.inject({
      method: 'GET',
      url: '/v1/identity/me',
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect((me.json() as { tenant_id: string }).tenant_id).toBe(T1);
    await app.close();
  });

  it('signing out with a tenant-A token revokes that session even when a later session exists', async () => {
    const { app } = await buildApp(h);
    const officer = randomUUID();
    const a = await officerToken(app, officer, T1, ['ROLE_IN_T1']);
    const b = await officerToken(app, officer, T2, ['ROLE_IN_T2']);
    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions/revoke',
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(revoke.statusCode).toBe(200);
    expect(await contextFor(a.token ?? '')).toBeNull();
    expect(await contextFor(b.token ?? '')).toMatchObject({ tenant_id: T2 });
    await app.close();
  });

  it('a DISABLED officer is not re-activated by sign-in and existing sessions stop working', async () => {
    const { app } = await buildApp(h);
    const officer = randomUUID();
    const live = await officerToken(app, officer, T1, ['ROLE_IN_T1']);
    expect(await contextFor(live.token ?? '')).not.toBeNull();
    await h.admin.query(
      `UPDATE sf_identity.officer_principal SET status = 'DISABLED' WHERE tenant_id = $1 AND officer_id = $2`,
      [T1, officer],
    );
    expect(await contextFor(live.token ?? '')).toBeNull();
    const again = await officerToken(app, officer, T1, ['ROLE_IN_T1']);
    expect(again.status).toBe(403);
    const status = await h.admin.query<{ status: string }>(
      'SELECT status FROM sf_identity.officer_principal WHERE tenant_id = $1 AND officer_id = $2',
      [T1, officer],
    );
    expect(status.rows[0]?.status).toBe('DISABLED');
    await app.close();
  });
});
