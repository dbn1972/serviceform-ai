import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { createCredentialStatusReadPort } from '../../src/service/service.js';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  ACTOR_QR,
  CRED_1,
  ctxFor,
  TENANT_A,
} from '../doubles/fixtures.js';
import { BASE, makeHarness } from '../doubles/harness.js';
import type { MemoryRegistryRepository } from '../doubles/memory-repo.js';

const STATUS = `${BASE}/${CRED_1}/status`;

async function revoked() {
  const h = makeHarness();
  await h.active(CRED_1);
  await h.transition(CRED_1, 'suspend', 2, h.reason);
  const repo = h.repo as MemoryRegistryRepository;
  return { h, repo, before: JSON.stringify(repo.snapshot(TENANT_A)) };
}

describe('status read port never mutates status', () => {
  it('returns the SF-CON-CREDENTIAL-STATUS document from a read-only transaction', async () => {
    const { h, repo, before } = await revoked();
    const writes = repo.writeTxCount;
    const res = await h.call('GET', STATUS);
    expect(res.status).toBe(200);
    expect(res.body['credential_status']['current_status']).toBe('SUSPENDED');
    expect(res.body['credential_status']['history']).toHaveLength(3);
    expect(repo.readTxCount).toBe(1);
    expect(repo.writeTxCount).toBe(writes);
    expect(JSON.stringify(repo.snapshot(TENANT_A))).toBe(before);
  });

  it('repeated reads by the QR verification workload leave status and history untouched', async () => {
    const { h, repo, before } = await revoked();
    h.as(TENANT_A, ACTOR_QR, 'INTEGRATION');
    for (let i = 0; i < 5; i += 1) expect((await h.call('GET', STATUS)).status).toBe(200);
    expect(JSON.stringify(repo.snapshot(TENANT_A))).toBe(before);
  });

  it('a read carrying a body or any query parameter is refused before the PDP', async () => {
    const { h, repo, before } = await revoked();
    const pdpCalls = h.authorizer.calls.length;
    const withQuery = await h.call('GET', STATUS, undefined, { query: { to_status: 'ACTIVE' } });
    expect(withQuery.status).toBe(400);
    expect(withQuery.body['details'][0]['code']).toBe('READ_PORT_ACCEPTS_NO_QUERY');
    const withBody = await h.call('GET', STATUS, { current_status: 'ACTIVE' });
    expect(withBody.status).toBe(400);
    expect(withBody.body['details'][0]['code']).toBe('READ_PORT_ACCEPTS_NO_BODY');
    expect(h.authorizer.calls.length).toBe(pdpCalls);
    expect(JSON.stringify(repo.snapshot(TENANT_A))).toBe(before);
  });

  it('non-GET methods on the read path are refused', async () => {
    const { h, repo, before } = await revoked();
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await h.call(m, STATUS, { current_status: 'ACTIVE' });
      expect(res.status, m).toBe(400);
      expect(res.body['details']).toEqual([{ code: 'METHOD_NOT_ALLOWED' }]);
    }
    expect(JSON.stringify(repo.snapshot(TENANT_A))).toBe(before);
  });

  it('every GET route is a READ port and every READ port is a GET', () => {
    for (const r of ROUTE_DESCRIPTORS)
      expect(r.method === 'GET', r.operationId).toBe(r.port === 'READ');
    expect(ROUTE_DESCRIPTORS.filter((r) => r.port === 'READ').map((r) => r.operationId)).toEqual([
      'getCredentialStatus',
    ]);
  });

  it('the in-process read port is frozen and exposes only getStatus', async () => {
    const { h, repo, before } = await revoked();
    const port = createCredentialStatusReadPort(h.service);
    expect(Object.isFrozen(port)).toBe(true);
    expect(Object.keys(port)).toEqual(['getStatus']);
    const res = await port.getStatus(ctxFor(TENANT_A, ACTOR_QR, 'INTEGRATION'), CRED_1);
    expect(res.status).toBe(200);
    expect(JSON.stringify(repo.snapshot(TENANT_A))).toBe(before);
  });

  it('the read transaction view has no mutators and rejects state changes', async () => {
    const { repo } = await revoked();
    await repo.withReadTx(ctxFor(TENANT_A), (tx) => {
      expect(Object.keys(tx).sort()).toEqual(['getEntry', 'listHistory']);
      expect('insertHistory' in tx).toBe(false);
      expect('updateEntryStatus' in tx).toBe(false);
      return Promise.resolve();
    });
    await expect(
      repo.withReadTx(ctxFor(TENANT_A), async () => {
        const entry = repo.tenant(TENANT_A).entries.get(CRED_1);
        if (entry) entry.current_status = 'ACTIVE';
      }),
    ).rejects.toMatchObject({ code: '25006' });
  });

  it('citizens do not use the tenant-internal read port (public verification is CMP-023)', async () => {
    const { h } = await revoked();
    h.as(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    expect((await h.call('GET', STATUS)).status).toBe(403);
    h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    h.authorizer.deniedActions.add('CREDENTIAL_REGISTRY_STATUS_READ');
    expect((await h.call('GET', STATUS)).status).toBe(403);
  });

  it('unknown credential reads return 404', async () => {
    const h = makeHarness();
    h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    expect((await h.call('GET', STATUS)).status).toBe(404);
  });
});
