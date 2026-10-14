import { describe, expect, it } from 'vitest';
import {
  ACTOR_OFFICER,
  ACTOR_QR,
  CRED_1,
  CRED_2,
  ctxFor,
  ISSUER_REF,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { BASE, makeHarness } from '../doubles/harness.js';
import type { MemoryRegistryRepository } from '../doubles/memory-repo.js';

describe('tenant isolation (negative)', () => {
  it('tenant B cannot read, suspend, revoke or reissue a tenant A credential', async () => {
    const h = makeHarness();
    await h.active(CRED_1, TENANT_A);
    const repo = h.repo as MemoryRegistryRepository;
    const before = JSON.stringify(repo.snapshot(TENANT_A));
    h.as(TENANT_B, ACTOR_OFFICER, 'OFFICER');
    expect((await h.call('GET', `${BASE}/${CRED_1}/status`)).status).toBe(404);
    h.as(TENANT_B, ACTOR_QR, 'INTEGRATION');
    expect((await h.call('GET', `${BASE}/${CRED_1}/status`)).status).toBe(404);
    h.as(TENANT_B, ACTOR_OFFICER, 'OFFICER');
    expect((await h.transition(CRED_1, 'suspend', 2, h.reason)).status).toBe(404);
    expect((await h.transition(CRED_1, 'revoke', 2, h.reason)).status).toBe(404);
    expect(
      (await h.transition(CRED_1, 'reissue', 2, { superseded_by_credential_id: CRED_2 })).status,
    ).toBe(404);
    expect(JSON.stringify(repo.snapshot(TENANT_A))).toBe(before);
    expect(repo.tenant(TENANT_B).entries.size).toBe(0);
  });

  it('a reissue successor registered only in another tenant is not visible', async () => {
    const h = makeHarness();
    await h.register(CRED_2, TENANT_B);
    await h.active(CRED_1, TENANT_A);
    const res = await h.transition(CRED_1, 'reissue', 2, { superseded_by_credential_id: CRED_2 });
    expect(res.status).toBe(409);
    expect(res.body['details']).toEqual([{ code: 'SUCCESSOR_NOT_REGISTERED' }]);
  });

  it('the same credential id in two tenants keeps two independent registries', async () => {
    const h = makeHarness();
    await h.active(CRED_1, TENANT_A);
    await h.register(CRED_1, TENANT_B);
    h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    await h.transition(CRED_1, 'revoke', 2, h.reason);
    h.as(TENANT_B, ACTOR_OFFICER, 'OFFICER');
    const b = await h.call('GET', `${BASE}/${CRED_1}/status`);
    expect(b.body['credential_status']['current_status']).toBe('REGISTERED');
    expect(b.body['credential_status']['tenant_id']).toBe(TENANT_B);
  });

  it('idempotency keys are tenant scoped: replaying A key in B does not return A data', async () => {
    const h = makeHarness();
    h.as(TENANT_A, ctxFor(TENANT_A).actor.id, 'SYSTEM');
    await h.call(
      'POST',
      BASE,
      { credential_id: CRED_1, issuer_ref: ISSUER_REF },
      { key: 'shared-key-01' },
    );
    h.as(TENANT_B, ctxFor(TENANT_B).actor.id, 'SYSTEM');
    const res = await h.call(
      'POST',
      BASE,
      { credential_id: CRED_1, issuer_ref: ISSUER_REF },
      { key: 'shared-key-01' },
    );
    expect(res.status).toBe(201);
    expect(res.body['credential_status']['tenant_id']).toBe(TENANT_B);
  });

  it('tenant-identifying headers are refused (tenant comes from server context only)', async () => {
    const h = makeHarness();
    await h.active(CRED_1);
    for (const headers of [
      { 'x-tenant-id': TENANT_B },
      { 'X-SF-Tenant': TENANT_B },
      { forwarded: `for=1.2.3.4;tenant=${TENANT_B}` },
      { 'x-roles': 'PRIVILEGED_ADMIN' },
    ]) {
      const res = await h.call('GET', `${BASE}/${CRED_1}/status`, undefined, { headers });
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.body['error_code']).toBe('SF-TEN-002');
    }
  });

  it('a tenant_id in the body is refused as cross-tenant', async () => {
    const h = makeHarness();
    const res = await h.call('POST', BASE, {
      credential_id: CRED_1,
      issuer_ref: ISSUER_REF,
      tenant_id: TENANT_B,
    });
    expect(res.status).toBe(403);
    expect(res.body['error_code']).toBe('SF-TEN-002');
  });

  it('missing or tenant-less context fails closed (401)', async () => {
    const h = makeHarness();
    h.state.ctx = null;
    expect((await h.call('GET', `${BASE}/${CRED_1}/status`)).body['error_code']).toBe(
      'SF-AUTH-001',
    );
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    expect((await h.call('GET', `${BASE}/${CRED_1}/status`)).body['error_code']).toBe('SF-TEN-001');
  });

  it('every PEP input names the caller tenant as both subject and resource tenant', async () => {
    const h = makeHarness();
    await h.active(CRED_1, TENANT_A);
    await h.register(CRED_2, TENANT_B);
    for (const call of h.authorizer.calls) {
      expect(call.subject.tenant_id).toBe(call.resource.tenant_id);
      expect([TENANT_A, TENANT_B]).toContain(call.subject.tenant_id);
    }
  });
});
