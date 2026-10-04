import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  bearer,
  buildApp,
  closeHarness,
  installTenant,
  setupHarness,
  T1,
  T2,
  validFormPayload,
  validServicePayload,
  type Harness,
} from './helpers.js';

let h: Harness;
let leakCount = 0;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-033 RLS + API (INT-011/013)', () => {
  it('creates draft, validates with simulation marker, idempotent replay; wrong tenant denied', async () => {
    const { app } = await buildApp(h);
    installTenant('t1', T1);
    installTenant('t2', T2);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1', { 'idempotency-key': 'idem-doc-1' }),
      payload: {
        kind: 'SERVICE',
        document_key: 'generic.service',
        payload: validServicePayload,
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { document_id: string; status: string };
    expect(body.status).toBe('DRAFT');

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1', { 'idempotency-key': 'idem-doc-1' }),
      payload: {
        kind: 'SERVICE',
        document_key: 'generic.service',
        payload: validServicePayload,
      },
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { document_id: string }).document_id).toBe(body.document_id);

    const validated = await app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${body.document_id}/validate`,
      headers: bearer('t1', { 'idempotency-key': 'idem-val-1' }),
    });
    expect(validated.statusCode).toBe(200);
    const vbody = validated.json() as {
      status: string;
      simulation?: { simulation: boolean; test_run_id: string };
    };
    expect(vbody.status).toBe('VALIDATED');
    expect(vbody.simulation?.simulation).toBe(true);
    expect(vbody.simulation?.test_run_id).toBeTruthy();

    const published = await app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${body.document_id}/publish`,
      headers: bearer('t1', { 'idempotency-key': 'idem-pub-1' }),
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as { status: string }).status).toBe('PUBLISHED');

    const mutated = await app.inject({
      method: 'PATCH',
      url: `/v1/metadata/documents/${body.document_id}`,
      headers: bearer('t1', { 'idempotency-key': 'idem-mut-1' }),
      payload: { payload: { code: 'generic_service', title: 'mutated' } },
    });
    expect(mutated.statusCode).toBe(400);
    expect((mutated.json() as { error_code: string }).error_code).toBe('SF-SYS-003');

    const outbox = await h.admin.query<{ event_type: string; cnt: string }>(
      `SELECT event_type, count(*)::text AS cnt FROM sf_metadata.outbox_event
        WHERE tenant_id = $1 AND aggregate_id = $2 GROUP BY event_type`,
      [T1, body.document_id],
    );
    expect(outbox.rows.find((r) => r.event_type === 'MetadataDocumentCreated')?.cnt).toBe('1');
    expect(outbox.rows.find((r) => r.event_type === 'MetadataDocumentPublished')?.cnt).toBe('1');

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/metadata/documents/${body.document_id}`,
      headers: bearer('t2'),
    });
    expect([403, 404]).toContain(cross.statusCode);
    if (cross.statusCode === 200) leakCount += 1;
    const leaked = (cross.json() as { document_id?: string }).document_id;
    if (leaked === body.document_id) leakCount += 1;

    const own = await app.inject({
      method: 'GET',
      url: `/v1/metadata/documents/${body.document_id}`,
      headers: bearer('t1'),
    });
    expect(own.statusCode).toBe(200);

    await app.close();
  });

  it('rejects client-supplied tenant headers (no client tenant context)', async () => {
    const { app } = await buildApp(h);
    installTenant('t1h', T1);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1h', { 'idempotency-key': 'idem-hdr', 'x-tenant-id': T2 }),
      payload: {
        kind: 'FORM',
        document_key: 'generic.form',
        payload: validFormPayload,
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error_code: string }).error_code).toBe('SF-TEN-002');
    await app.close();
  });

  it('fails closed when schema registry port fails (INT-013)', async () => {
    const { app } = await buildApp(h);
    installTenant('t1ok', T1);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1ok', { 'idempotency-key': 'idem-fail-create' }),
      payload: {
        kind: 'SERVICE',
        document_key: 'generic.fail',
        payload: validServicePayload,
      },
    });
    expect(created.statusCode).toBe(201);
    const documentId = (created.json() as { document_id: string }).document_id;
    await app.close();

    const failApp = await buildApp(h, undefined, { registryFail: true });
    installTenant('t1fail', T1);
    const validated = await failApp.app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${documentId}/validate`,
      headers: bearer('t1fail', { 'idempotency-key': 'idem-fail-val' }),
    });
    expect(validated.statusCode).toBe(503);
    expect((validated.json() as { error_code: string }).error_code).toBe('SF-SYS-004');
    await failApp.app.close();
  });

  it('RLS hides T1 document from T2 session; CROSS_TENANT_LEAKAGE=0', async () => {
    const { app } = await buildApp(h);
    installTenant('t1r', T1);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1r', { 'idempotency-key': 'idem-rls-1' }),
      payload: {
        kind: 'SERVICE',
        document_key: 'generic.rls',
        payload: validServicePayload,
      },
    });
    expect(created.statusCode).toBe(201);
    const documentId = (created.json() as { document_id: string }).document_id;
    await app.close();

    const t2rows = await asTenant(h.rt, T2, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', async (c) => {
      const r = await c.query<{ document_id: string }>(
        `SELECT document_id FROM sf_metadata.metadata_document WHERE document_id = $1`,
        [documentId],
      );
      return r.rows;
    });
    expect(t2rows.length).toBe(0);
    if (t2rows.length > 0) leakCount += t2rows.length;
    expect(leakCount).toBe(0);
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakCount);
  });

  it('composes a bundle from validated documents and reports missing kinds structurally', async () => {
    const { app } = await buildApp(h);
    installTenant('t1c', T1);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/metadata/documents',
      headers: bearer('t1c', { 'idempotency-key': 'idem-cmp-1' }),
      payload: {
        kind: 'FORM',
        document_key: 'generic.form.compose',
        payload: validFormPayload,
      },
    });
    const documentId = (created.json() as { document_id: string }).document_id;
    const validated = await app.inject({
      method: 'POST',
      url: `/v1/metadata/documents/${documentId}/validate`,
      headers: bearer('t1c', { 'idempotency-key': 'idem-cmp-val' }),
    });
    expect(validated.statusCode).toBe(200);
    const composed = await app.inject({
      method: 'POST',
      url: '/v1/metadata/bundles',
      headers: bearer('t1c', { 'idempotency-key': 'idem-cmp-b' }),
      payload: { bundle_key: 'generic.bundle', document_ids: [documentId] },
    });
    expect(composed.statusCode).toBe(201);
    const bundle = composed.json() as { missing_kinds: string[]; status: string };
    expect(bundle.status).toBe('COMPOSED');
    expect(bundle.missing_kinds).toContain('SERVICE');
    expect(bundle.missing_kinds).toContain('WORKFLOW');
    await app.close();
  });
});
