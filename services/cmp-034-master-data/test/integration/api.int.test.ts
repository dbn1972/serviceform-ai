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
import { randomUUID } from 'node:crypto';

const simBinding = {
  connector_binding_id: 'd17e5fc0-28e4-4b6a-b9d1-04cfa0e28d5d',
  tenant_id: T1,
  connector_type: 'DEPARTMENT_API',
  mode: 'SIMULATED',
  environment: 'LOCAL',
  critical: true,
  secret_ref: null,
  simulator_version: '0.0.0',
};

describe('CMP-034 API + tenant negatives + INT-013', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('happy path: draft values, publish, pin, import SIMULATED; published mutation fail-closed', async () => {
    const { app, authorizer } = await buildApp(h);
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
    fixtures.set('t2', ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_A } }));

    const created = await app.inject({
      method: 'POST',
      url: '/v1/code-sets',
      headers: { ...bearer('t1'), ...idem('idem-set-1') },
      payload: { set_code: 'GENERIC_SET', localization_key: 'md.generic_set' },
    });
    expect(created.statusCode).toBe(201);
    const setId = (created.json() as { code_set_id: string }).code_set_id;

    const version = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions`,
      headers: { ...bearer('t1'), ...idem('idem-ver-1') },
      payload: { jurisdiction_ref: 'opaque-jur-ref' },
    });
    expect(version.statusCode).toBe(201);
    const versionNo = (version.json() as { version_no: number }).version_no;

    const imported = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/import`,
      headers: { ...bearer('t1'), ...idem('idem-imp-1') },
      payload: {
        connector_binding: simBinding,
        scenario: 'code_list_success',
        test_run_id: 'ci-md-001',
      },
    });
    expect(imported.statusCode).toBe(201);
    const importBody = imported.json() as {
      source_mode: string;
      simulation: { simulation: boolean };
    };
    expect(importBody.source_mode).toBe('CONNECTOR');
    expect(importBody.simulation.simulation).toBe(true);

    const published = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/publish`,
      headers: { ...bearer('t1'), ...idem('idem-pub-1') },
      payload: { reason: 'release-1' },
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as { status: string }).status).toBe('PUBLISHED');

    const mutate = await app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/values`,
      headers: { ...bearer('t1'), ...idem('idem-mut-1') },
      payload: {
        items: [{ value_code: 'ITEM_Z', localization_key: 'md.z', sort_order: 9 }],
      },
    });
    expect(mutate.statusCode).toBe(400);
    expect(JSON.stringify(mutate.json())).toContain('PUBLISHED_IMMUTABLE');

    const bindDraft = await app.inject({
      method: 'POST',
      url: '/v1/code-set-bindings',
      headers: { ...bearer('t1'), ...idem('idem-bind-bad') },
      payload: {
        code_set_id: setId,
        pinned_version_no: versionNo + 1,
        target_type: 'FORM_FIELD',
        target_ref: 'field.generic',
      },
    });
    expect(bindDraft.statusCode).toBe(404);

    const bind = await app.inject({
      method: 'POST',
      url: '/v1/code-set-bindings',
      headers: { ...bearer('t1'), ...idem('idem-bind-1') },
      payload: {
        code_set_id: setId,
        pinned_version_no: versionNo,
        target_type: 'FORM_FIELD',
        target_ref: 'field.generic',
      },
    });
    expect(bind.statusCode).toBe(201);

    const resolved = await app.inject({
      method: 'GET',
      url: `/v1/code-sets/${setId}/resolve?value_code=ITEM_A&as_of=2026-10-04T13:00:00.000Z`,
      headers: bearer('t1'),
    });
    expect(resolved.statusCode).toBe(200);
    expect((resolved.json() as { items: { value_code: string }[] }).items[0]?.value_code).toBe(
      'ITEM_A',
    );

    const prodEnv = await buildApp(h, authorizer, 'PRODUCTION');
    fixtures.set('t1p', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
    const prodSim = await prodEnv.app.inject({
      method: 'POST',
      url: `/v1/code-sets/${setId}/versions/${versionNo}/import`,
      headers: { ...bearer('t1p'), ...idem('idem-prod-sim') },
      payload: { connector_binding: { ...simBinding, environment: 'PRODUCTION' } },
    });
    expect(prodSim.statusCode).toBe(400);
    expect(JSON.stringify(prodSim.json())).not.toContain(CANARY);
    await prodEnv.app.close();
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));

    authorizer.denies.add('CODE_SET_READ');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/code-sets',
      headers: bearer('t1'),
    });
    expect(denied.statusCode).toBe(403);
    expect(JSON.stringify(denied.json())).not.toContain(CANARY);
    authorizer.denies.clear();

    await asTenant(h.rt, T2, ACTOR_A, async (c) => {
      await c.query(
        `INSERT INTO sf_master_data.code_set (
           tenant_id, code_set_id, set_code, localization_key, status, created_by
         ) VALUES ($1,$2,'SET_Z',$3,'ACTIVE',$4)`,
        [T2, randomUUID(), CANARY, ACTOR_A],
      );
    });
    const list = await app.inject({
      method: 'GET',
      url: '/v1/code-sets',
      headers: bearer('t1'),
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(CANARY);

    const forged = await app.inject({
      method: 'GET',
      url: '/v1/code-sets',
      headers: { ...bearer('t1'), 'x-tenant-id': T2 },
    });
    expect(forged.statusCode).toBe(403);

    const unauth = await app.inject({ method: 'GET', url: '/v1/code-sets' });
    expect(unauth.statusCode).toBe(401);

    const events = await h.admin.query(
      `SELECT event_type FROM sf_master_data.outbox_event
        WHERE tenant_id = $1 ORDER BY seq`,
      [T1],
    );
    const types = events.rows.map((r) => r.event_type as string);
    expect(types).toContain('CodeSetVersionPublished');
    expect(types).toContain('CodeSetImported');
    expect(types).toContain('AuditEventSubmitted');

    await app.close();
  }, 120_000);
});
