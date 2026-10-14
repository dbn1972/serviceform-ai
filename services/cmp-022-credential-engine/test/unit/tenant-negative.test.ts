import { describe, expect, it } from 'vitest';
import { credentialIdFor } from '../../src/domain/credential.js';
import {
  APPLICATION_ID,
  ctxFor,
  ISSUANCE_KEY,
  pins,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ISSUE = { application_id: APPLICATION_ID, issuance_key: ISSUANCE_KEY };
const ID_A = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);

async function issuedInA(): Promise<ReturnType<typeof makeHarness>> {
  const h = makeHarness();
  expect((await h.call('POST', '/v1/credentials', ISSUE)).status).toBe(201);
  h.state.ctx = ctxFor(TENANT_B);
  return h;
}

describe('tenant isolation (tenant-negative)', () => {
  it('tenant B cannot read tenant A credentials, lists or signing records', async () => {
    const h = await issuedInA();
    const get = await h.call('GET', `/v1/credentials/${ID_A}`, undefined, { key: null });
    expect(get.status).toBe(404);
    const records = await h.call('GET', `/v1/credentials/${ID_A}/signing-records`, undefined, {
      key: null,
    });
    expect(records.status).toBe(404);
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/credentials`, undefined, {
      key: null,
    });
    expect((list.body as Body)['credentials']).toEqual([]);
    expect(JSON.stringify([get.body, records.body, list.body])).not.toContain(TENANT_A);
  });

  it('tenant B cannot record a downstream outcome against tenant A credential', async () => {
    const h = await issuedInA();
    h.state.ctx = ctxFor(TENANT_B, undefined, 'INTEGRATION');
    const res = await h.call('POST', `/v1/credentials/${ID_A}/downstream-outcomes`, {
      channel: 'DIGILOCKER_PUBLISH',
      outcome: 'FAILED',
      outcome_ref: 'dispatch:0001',
      failure_code: 'SF-INT-001',
    });
    expect(res.status).toBe(404);
    expect(h.repo.tenant(TENANT_A).outcomes).toHaveLength(0);
  });

  it('tenant B cannot issue for an application that only tenant A can see', async () => {
    const h = await issuedInA();
    const res = await h.call('POST', '/v1/credentials', ISSUE);
    expect(res.status).toBe(404);
    expect(h.repo.tenant(TENANT_B).credentials.size).toBe(0);
    expect(h.renderer.calls).toHaveLength(1);
  });

  it('identical application id and issuance key in two tenants give distinct credentials', async () => {
    const h = await issuedInA();
    h.casePins.set(TENANT_B, pins());
    const res = await h.call('POST', '/v1/credentials', ISSUE);
    expect(res.status).toBe(201);
    expect((res.body as Body)['tenant_id']).toBe(TENANT_B);
    expect((res.body as Body)['credential_id']).not.toBe(ID_A);
    expect(h.repo.tenant(TENANT_A).credentials.size).toBe(1);
    expect(h.repo.tenant(TENANT_B).credentials.size).toBe(1);
    for (const o of h.repo.tenant(TENANT_B).outbox) expect(o.envelope.tenant_id).toBe(TENANT_B);
  });

  it('replaying tenant A Idempotency-Key from tenant B does not leak the stored response', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/credentials', ISSUE, { key: 'shared-key-0001' });
    h.state.ctx = ctxFor(TENANT_B);
    const res = await h.call('POST', '/v1/credentials', ISSUE, { key: 'shared-key-0001' });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(ID_A);
  });

  it('missing or tenant-less context is refused before any port call', async () => {
    const h = makeHarness();
    h.state.ctx = null;
    expect(((await h.call('POST', '/v1/credentials', ISSUE)).body as Body)['error_code']).toBe(
      'SF-AUTH-001',
    );
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    expect(((await h.call('POST', '/v1/credentials', ISSUE)).body as Body)['error_code']).toBe(
      'SF-TEN-001',
    );
    expect(h.authorizer.calls).toHaveLength(0);
    expect(h.casePins.calls).toBe(0);
  });

  it.each([
    ['x-tenant-id', TENANT_B],
    ['X-SF-Tenant', TENANT_B],
    ['x-roles', 'admin'],
    ['x-actor-type', 'SYSTEM'],
    ['forwarded', `for=1.2.3.4;tenant=${TENANT_B}`],
  ])('tenant/role-identifying header %s is refused', async (name, value) => {
    const h = makeHarness();
    const res = await h.call('POST', '/v1/credentials', ISSUE, { headers: { [name]: value } });
    expect(res.status).toBe(403);
    expect((res.body as Body)['error_code']).toBe('SF-TEN-002');
    expect(h.casePins.calls).toBe(0);
  });

  it('a context whose subject and resource tenants differ is denied before OPA', async () => {
    const { authorize, authzInput } = await import('../../src/authz.js');
    const h = makeHarness();
    const input = authzInput(ctxFor(TENANT_A), 'CREDENTIAL_ISSUE');
    input.resource.tenant_id = TENANT_B;
    await expect(authorize(h.authorizer, input)).rejects.toMatchObject({ code: 'SF-TEN-002' });
    expect(h.authorizer.calls).toHaveLength(0);
  });
});
