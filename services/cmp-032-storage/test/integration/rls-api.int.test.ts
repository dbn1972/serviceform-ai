import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  asTenant,
  bearer,
  buildApp,
  closeHarness,
  installTenant,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-032 RLS + API (INT-011/013)', () => {
  it('stores object with simulation marker; idempotent replay; wrong tenant denied', async () => {
    const { app } = await buildApp(h);
    installTenant('t1', T1);
    installTenant('t2', T2);
    const payload = {
      content_type: 'application/octet-stream',
      content_base64: Buffer.from('hello-storage').toString('base64'),
    };

    const created = await app.inject({
      method: 'POST',
      url: '/v1/storage/objects',
      headers: bearer('t1', { 'idempotency-key': 'idem-store-1' }),
      payload,
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      object_id: string;
      simulation?: { simulation: boolean; test_run_id: string };
      storage_mode: string;
    };
    expect(body.storage_mode).toBe('SIMULATED');
    expect(body.simulation?.simulation).toBe(true);
    expect(body.simulation?.test_run_id).toBeTruthy();

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/storage/objects',
      headers: bearer('t1', { 'idempotency-key': 'idem-store-1' }),
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { object_id: string }).object_id).toBe(body.object_id);

    // Producers have INSERT-only on outbox (SF-CON-OUTBOX); verify via admin.
    const outbox = await h.admin.query<{ event_type: string; cnt: string }>(
      `SELECT event_type, count(*)::text AS cnt FROM sf_storage.outbox_event
        WHERE tenant_id = $1 AND aggregate_id = $2 GROUP BY event_type`,
      [T1, body.object_id],
    );
    expect(outbox.rows.find((r) => r.event_type === 'ObjectStored')?.cnt).toBe('1');

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/storage/objects/${body.object_id}/access`,
      headers: bearer('t2'),
    });
    expect([403, 404]).toContain(cross.statusCode);

    const access = await app.inject({
      method: 'GET',
      url: `/v1/storage/objects/${body.object_id}/access`,
      headers: bearer('t1'),
    });
    expect(access.statusCode).toBe(200);
    const accessBody = access.json() as { access_url: string; simulation?: { simulation: boolean } };
    expect(accessBody.access_url.startsWith('sim://storage/')).toBe(true);
    expect(accessBody.simulation?.simulation).toBe(true);

    const archived = await app.inject({
      method: 'POST',
      url: `/v1/storage/objects/${body.object_id}/archive`,
      headers: bearer('t1', { 'idempotency-key': 'idem-arch-1' }),
    });
    expect(archived.statusCode).toBe(200);
    expect((archived.json() as { status: string }).status).toBe('ARCHIVED');

    await app.close();
  });

  it('fails closed when KMS or secrets ports fail', async () => {
    const kmsApp = await buildApp(h, undefined, { kmsFail: true });
    installTenant('t1k', T1);
    const kmsRes = await kmsApp.app.inject({
      method: 'POST',
      url: '/v1/storage/objects',
      headers: bearer('t1k', { 'idempotency-key': 'idem-kms-fail' }),
      payload: {
        content_type: 'application/octet-stream',
        content_base64: Buffer.from('x').toString('base64'),
      },
    });
    expect(kmsRes.statusCode).toBe(503);
    expect((kmsRes.json() as { error_code: string }).error_code).toBe('SF-SYS-004');
    await kmsApp.app.close();

    const ok = await buildApp(h);
    installTenant('t1s', T1);
    const created = await ok.app.inject({
      method: 'POST',
      url: '/v1/storage/objects',
      headers: bearer('t1s', { 'idempotency-key': 'idem-sec-1' }),
      payload: {
        content_type: 'application/octet-stream',
        content_base64: Buffer.from('y').toString('base64'),
      },
    });
    expect(created.statusCode).toBe(201);
    const objectId = (created.json() as { object_id: string }).object_id;
    await ok.app.close();

    const secretApp = await buildApp(h, undefined, { secretsFail: true });
    installTenant('t1s2', T1);
    const access = await secretApp.app.inject({
      method: 'GET',
      url: `/v1/storage/objects/${objectId}/access`,
      headers: bearer('t1s2'),
    });
    expect(access.statusCode).toBe(503);
    await secretApp.app.close();
  });

  it('RLS hides T1 object from T2 session', async () => {
    const { app } = await buildApp(h);
    installTenant('t1r', T1);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/storage/objects',
      headers: bearer('t1r', { 'idempotency-key': 'idem-rls-1' }),
      payload: {
        content_type: 'application/octet-stream',
        content_base64: Buffer.from('rls').toString('base64'),
      },
    });
    const objectId = (created.json() as { object_id: string }).object_id;
    const t2rows = await asTenant(h.rt, T2, ACTOR, async (c) => {
      const r = await c.query(`SELECT object_id FROM sf_storage.object_metadata WHERE object_id = $1`, [
        objectId,
      ]);
      return r.rowCount;
    });
    expect(t2rows).toBe(0);
    await app.close();
  });
});
