import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  bearer,
  buildApp,
  CHECKER,
  closeHarness,
  HASH,
  installActor,
  MAKER,
  setupHarness,
  SUBJECT,
  T1,
  T2,
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

describe('CMP-051 RLS + API (INT-011/013)', () => {
  it('checker approval required; maker cannot approve; decisions immutable', async () => {
    const { app } = await buildApp(h);
    installActor('maker', T1, MAKER);
    installActor('checker', T1, CHECKER);
    installActor('t2', T2, MAKER);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/publication-requests',
      headers: bearer('maker', { 'idempotency-key': 'idem-req-1' }),
      payload: { subject_id: SUBJECT, proposed_hash: HASH },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { request_id: string; status: string };
    expect(body.status).toBe('DRAFT');

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/publication-requests',
      headers: bearer('maker', { 'idempotency-key': 'idem-req-1' }),
      payload: { subject_id: SUBJECT, proposed_hash: HASH },
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { request_id: string }).request_id).toBe(body.request_id);

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/publication-requests/${body.request_id}/submit`,
      headers: bearer('maker', { 'idempotency-key': 'idem-sub-1' }),
    });
    expect(submitted.statusCode).toBe(200);

    const selfApprove = await app.inject({
      method: 'POST',
      url: `/v1/publication-requests/${body.request_id}/approve`,
      headers: bearer('maker', { 'idempotency-key': 'idem-self' }),
      payload: { reason: 'maker-self-approve' },
    });
    expect(selfApprove.statusCode).toBe(403);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/publication-requests/${body.request_id}/approve`,
      headers: bearer('checker', { 'idempotency-key': 'idem-ok' }),
      payload: { reason: 'checker-approval' },
    });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as { status: string }).status).toBe('APPROVED');

    const mutate = await app.inject({
      method: 'POST',
      url: `/v1/publication-requests/${body.request_id}/reject`,
      headers: bearer('checker', { 'idempotency-key': 'idem-mut' }),
      payload: { reason: 'cannot-mutate-decision' },
    });
    expect(mutate.statusCode).toBe(400);

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/publication-requests/${body.request_id}`,
      headers: bearer('t2'),
    });
    expect([403, 404]).toContain(cross.statusCode);
    if (cross.statusCode === 200) leakCount += 1;

    await app.close();
  });

  it('rejects client-supplied tenant headers', async () => {
    const { app } = await buildApp(h);
    installActor('makerh', T1, MAKER);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/publication-requests',
      headers: bearer('makerh', { 'idempotency-key': 'idem-hdr', 'x-tenant-id': T2 }),
      payload: { subject_id: SUBJECT, proposed_hash: HASH },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error_code: string }).error_code).toBe('SF-TEN-002');
    await app.close();
  });

  it('fails closed when metadata port fails (INT-013)', async () => {
    const { app } = await buildApp(h, undefined, { metadataFail: true });
    installActor('makerf', T1, MAKER);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/publication-requests',
      headers: bearer('makerf', { 'idempotency-key': 'idem-fail' }),
      payload: { subject_id: SUBJECT, proposed_hash: HASH },
    });
    expect(created.statusCode).toBe(503);
    expect((created.json() as { error_code: string }).error_code).toBe('SF-SYS-004');
    await app.close();
  });

  it('RLS hides T1 request from T2 session; CROSS_TENANT_LEAKAGE=0', async () => {
    const { app } = await buildApp(h);
    installActor('makerr', T1, MAKER);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/publication-requests',
      headers: bearer('makerr', { 'idempotency-key': 'idem-rls-1' }),
      payload: {
        subject_id: '44444444-4444-4444-8444-444444444444',
        proposed_hash: HASH,
      },
    });
    expect(created.statusCode).toBe(201);
    const requestId = (created.json() as { request_id: string }).request_id;
    await app.close();

    const t2rows = await asTenant(h.rt, T2, MAKER, async (c) => {
      const r = await c.query<{ request_id: string }>(
        `SELECT request_id FROM sf_maker_checker.publication_request WHERE request_id = $1`,
        [requestId],
      );
      return r.rows;
    });
    expect(t2rows.length).toBe(0);
    if (t2rows.length > 0) leakCount += t2rows.length;
    expect(leakCount).toBe(0);
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakCount);
  });
});
