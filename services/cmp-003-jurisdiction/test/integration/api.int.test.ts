import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR_A,
  ACTOR_OFFICER,
  CANARY,
  T1,
  T2,
  asTenant,
  bearer,
  buildApp,
  closeHarness,
  ctx,
  idem,
  setupHarness,
  type Harness,
} from './helpers.js';
import { fixtures } from '../doubles/context-resolver.js';

describe('CMP-003 API + tenant negatives', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('happy path: types, hierarchy, publish, resolve, binding; cycle and unknown address fail closed', async () => {
    const { app, authorizer } = await buildApp(h);
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
    fixtures.set('t2', ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_A } }));

    const typeRes = await app.inject({
      method: 'POST',
      url: '/v1/jurisdiction-types',
      headers: { ...bearer('t1'), ...idem('idem-type-1') },
      payload: { type_code: 'LEVEL_A', display_label: 'Configurable Level A' },
    });
    expect(typeRes.statusCode).toBe(201);
    const typeId = (typeRes.json() as { jurisdiction_type_id: string }).jurisdiction_type_id;

    const root = await app.inject({
      method: 'POST',
      url: '/v1/jurisdictions',
      headers: { ...bearer('t1'), ...idem('idem-jur-1') },
      payload: {
        code: 'root-a',
        name: 'Root Node',
        jurisdiction_type_id: typeId,
      },
    });
    expect(root.statusCode).toBe(201);
    const rootId = (root.json() as { jurisdiction_id: string }).jurisdiction_id;

    const child = await app.inject({
      method: 'POST',
      url: '/v1/jurisdictions',
      headers: { ...bearer('t1'), ...idem('idem-jur-2') },
      payload: {
        code: 'child-a',
        name: 'Child Node',
        jurisdiction_type_id: typeId,
        parent_id: rootId,
      },
    });
    expect(child.statusCode).toBe(201);
    const childId = (child.json() as { jurisdiction_id: string }).jurisdiction_id;

    const children = await app.inject({
      method: 'GET',
      url: `/v1/jurisdictions/${rootId}/children`,
      headers: bearer('t1'),
    });
    expect(children.statusCode).toBe(200);
    expect((children.json() as { items: unknown[] }).items).toHaveLength(1);

    const cycle = await app.inject({
      method: 'POST',
      url: `/v1/jurisdictions/${rootId}/relations`,
      headers: { ...bearer('t1'), ...idem('idem-rel-cycle') },
      payload: { parent_id: childId, relation_type_code: 'CONTAINS' },
    });
    expect(cycle.statusCode).toBe(400);
    expect(JSON.stringify(cycle.json())).toContain('HIERARCHY_CYCLE');

    const published = await app.inject({
      method: 'POST',
      url: `/v1/jurisdictions/${childId}/publish`,
      headers: { ...bearer('t1'), ...idem('idem-pub-1') },
      payload: { reason: 'release-1' },
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as { status: string }).status).toBe('PUBLISHED');

    const bind = await app.inject({
      method: 'POST',
      url: '/v1/jurisdiction-bindings',
      headers: { ...bearer('t1'), ...idem('idem-bind-1') },
      payload: {
        jurisdiction_id: childId,
        target_type: 'ADDRESS_KEY',
        target_ref: 'addr-key-001',
      },
    });
    expect(bind.statusCode).toBe(201);

    const resolved = await app.inject({
      method: 'POST',
      url: '/v1/jurisdiction/resolve',
      headers: bearer('t1'),
      payload: { mode: 'BY_ADDRESS_KEY', value: 'addr-key-001' },
    });
    expect(resolved.statusCode).toBe(200);
    expect((resolved.json() as { jurisdiction_id: string }).jurisdiction_id).toBe(childId);

    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/jurisdiction/resolve',
      headers: bearer('t1'),
      payload: { mode: 'BY_ADDRESS_KEY', value: 'missing-address' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(JSON.stringify(unknown.json())).toContain('UNKNOWN_ADDRESS');

    authorizer.denies.add('JURISDICTION_READ');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/jurisdictions',
      headers: bearer('t1'),
    });
    expect(denied.statusCode).toBe(403);
    expect(JSON.stringify(denied.json())).not.toContain(CANARY);
    authorizer.denies.clear();

    // Seed T2 canary and prove T1 list does not leak it
    await asTenant(h.rt, T2, ACTOR_A, async (c) => {
      const tid = randomUUID();
      await c.query(
        `INSERT INTO sf_jurisdiction.jurisdiction_type (
           tenant_id, jurisdiction_type_id, type_code, display_label, status, created_by
         ) VALUES ($1,$2,'LEVEL_Z',$3,'ACTIVE',$4)`,
        [T2, tid, CANARY, ACTOR_A],
      );
    });
    const list = await app.inject({
      method: 'GET',
      url: '/v1/jurisdiction-types',
      headers: bearer('t1'),
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(CANARY);

    const forged = await app.inject({
      method: 'GET',
      url: '/v1/jurisdictions',
      headers: { ...bearer('t1'), 'x-tenant-id': T2 },
    });
    expect(forged.statusCode).toBe(403);

    const unauth = await app.inject({ method: 'GET', url: '/v1/jurisdictions' });
    expect(unauth.statusCode).toBe(401);

    // Producers have INSERT-only on outbox (SF-CON-OUTBOX); assert via admin.
    const events = await h.admin.query(
      `SELECT event_type FROM sf_jurisdiction.outbox_event
        WHERE tenant_id = $1 ORDER BY seq`,
      [T1],
    );
    const types = events.rows.map((r) => r.event_type as string);
    expect(types).toContain('JurisdictionVersionPublished');
    expect(types).toContain('JurisdictionBoundaryChanged');
    expect(types).toContain('AuditEventSubmitted');

    await app.close();
  }, 120_000);
});
