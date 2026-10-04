import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  ACTOR,
  bearer,
  buildApp,
  closeHarness,
  installTenant,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';
import { validPins } from '../fixtures/pins.js';

let h: Harness;
let leakCount = 0;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-052 RLS + publish (INT-011/013)', () => {
  it('requires checker approval, keeps published hash stable, refuses mutation', async () => {
    const deny = await buildApp(h, { denyApproval: true });
    installTenant('t1d', T1);
    const draft = await deny.app.inject({
      method: 'POST',
      url: '/v1/tenant-service-bindings',
      headers: bearer('t1d', { 'idempotency-key': 'idem-den-1' }),
      payload: {
        binding_key: 'generic.denied',
        offering_ref: 'offering-1',
        metadata_bundle_ref: 'bundle-1',
        pins: validPins(),
      },
    });
    expect(draft.statusCode).toBe(201);
    const deniedId = (draft.json() as { binding_id: string }).binding_id;
    const refused = await deny.app.inject({
      method: 'POST',
      url: `/v1/tenant-service-bindings/${deniedId}/publish`,
      headers: bearer('t1d', { 'idempotency-key': 'idem-den-p' }),
    });
    expect(refused.statusCode).toBe(400);
    await deny.app.close();

    const { app } = await buildApp(h);
    installTenant('t1', T1);
    installTenant('t2', T2);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tenant-service-bindings',
      headers: bearer('t1', { 'idempotency-key': 'idem-ok-1' }),
      payload: {
        binding_key: 'generic.offering',
        offering_ref: 'offering-1',
        metadata_bundle_ref: 'bundle-1',
        pins: validPins(),
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { binding_id: string; artifact_hash: string };
    const published = await app.inject({
      method: 'POST',
      url: `/v1/tenant-service-bindings/${body.binding_id}/publish`,
      headers: bearer('t1', { 'idempotency-key': 'idem-ok-p' }),
    });
    expect(published.statusCode).toBe(200);
    const pub = published.json() as {
      status: string;
      artifact_hash: string;
      published_version_id: string;
    };
    expect(pub.status).toBe('PUBLISHED');
    expect(pub.artifact_hash).toBe(body.artifact_hash);

    const mutate = await app.inject({
      method: 'PATCH',
      url: `/v1/tenant-service-bindings/${body.binding_id}`,
      headers: bearer('t1', { 'idempotency-key': 'idem-mut' }),
      payload: { offering_ref: 'nope' },
    });
    expect(mutate.statusCode).toBe(400);

    await expect(
      asTenant(h.rt, T1, ACTOR, async (c) => {
        await c.query(
          `UPDATE sf_versioning.tenant_service_binding SET offering_ref = 'x' WHERE binding_id = $1`,
          [body.binding_id],
        );
      }),
    ).rejects.toThrow();

    const version = await app.inject({
      method: 'GET',
      url: `/v1/artifact-versions/${pub.published_version_id}`,
      headers: bearer('t1'),
    });
    expect(version.statusCode).toBe(200);
    expect((version.json() as { content_hash: string }).content_hash).toBe(body.artifact_hash);

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/tenant-service-bindings/${body.binding_id}`,
      headers: bearer('t2'),
    });
    expect([403, 404]).toContain(cross.statusCode);
    if (cross.statusCode === 200) leakCount += 1;
    await app.close();
  });

  it('rejects client tenant headers and fails closed if approval port throws', async () => {
    const { app } = await buildApp(h, { failApproval: true });
    installTenant('t1f', T1);
    const hdr = await app.inject({
      method: 'POST',
      url: '/v1/tenant-service-bindings',
      headers: bearer('t1f', { 'idempotency-key': 'idem-hdr', 'x-tenant-id': T2 }),
      payload: {
        binding_key: 'generic.hdr',
        offering_ref: 'offering-1',
        metadata_bundle_ref: 'bundle-1',
        pins: validPins(),
      },
    });
    expect(hdr.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/tenant-service-bindings',
      headers: bearer('t1f', { 'idempotency-key': 'idem-fail-c' }),
      payload: {
        binding_key: 'generic.fail',
        offering_ref: 'offering-1',
        metadata_bundle_ref: 'bundle-1',
        pins: validPins(),
      },
    });
    const id = (created.json() as { binding_id: string }).binding_id;
    const published = await app.inject({
      method: 'POST',
      url: `/v1/tenant-service-bindings/${id}/publish`,
      headers: bearer('t1f', { 'idempotency-key': 'idem-fail-p' }),
    });
    expect(published.statusCode).toBe(503);
    expect((published.json() as { error_code: string }).error_code).toBe('SF-SYS-004');
    await app.close();
  });

  it('RLS hides T1 binding from T2; CROSS_TENANT_LEAKAGE=0', async () => {
    const { app } = await buildApp(h);
    installTenant('t1r', T1);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tenant-service-bindings',
      headers: bearer('t1r', { 'idempotency-key': 'idem-rls' }),
      payload: {
        binding_key: 'generic.rls',
        offering_ref: 'offering-1',
        metadata_bundle_ref: 'bundle-1',
        pins: validPins(),
      },
    });
    const bindingId = (created.json() as { binding_id: string }).binding_id;
    await app.close();
    const t2rows = await asTenant(h.rt, T2, ACTOR, async (c) => {
      const r = await c.query<{ binding_id: string }>(
        `SELECT binding_id FROM sf_versioning.tenant_service_binding WHERE binding_id = $1`,
        [bindingId],
      );
      return r.rows;
    });
    expect(t2rows.length).toBe(0);
    if (t2rows.length > 0) leakCount += t2rows.length;
    expect(leakCount).toBe(0);
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakCount);
  });
});
