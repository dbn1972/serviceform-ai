import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  asTenant,
  buildApp,
  closeHarness,
  installTenant,
  setupHarness,
  T1,
  T2,
  withIsolatedCmp009Database,
  type Harness,
} from './helpers.js';
import { formFixture, pinOf, validData } from '../fixtures/forms.js';
import type { SimulatedFormDefinitionPort } from '../../src/ports/form-definition.js';

let h: Harness;
let app: FastifyInstance;
let forms: SimulatedFormDefinitionPort;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

function execute(token: string, body: unknown, key = `k-${randomUUID()}`) {
  return app.inject({
    method: 'POST',
    url: '/v1/executions',
    headers: { ...bearer(token), 'idempotency-key': key },
    payload: body as object,
  });
}

beforeAll(async () => {
  h = await setupHarness();
  const built = await buildApp(h);
  app = built.app;
  forms = built.forms;
  installTenant('t1', T1);
  installTenant('t2', T2);
});
afterAll(async () => {
  await app?.close();
  await closeHarness(h);
});

describe('CMP-009 API + RLS integration (real PostgreSQL)', () => {
  it('validates for tenant 1 and persists snapshot, execution, outbox and audit rows', async () => {
    const form = formFixture(T1);
    forms.publish(form);
    const res = await execute('t1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(res.statusCode).toBe(201);
    const rows = await h.admin.query(
      `SELECT (SELECT count(*) FROM sf_forms.form_definition_snapshot WHERE tenant_id = $1)::int AS snaps,
              (SELECT count(*) FROM sf_forms.form_execution_record WHERE tenant_id = $1)::int AS execs,
              (SELECT count(*) FROM sf_forms.outbox_event WHERE tenant_id = $1)::int AS events,
              (SELECT count(*) FROM sf_forms.outbox_event WHERE tenant_id = $1 AND topic = 'sf.audit.ingest.v1')::int AS audits`,
      [T1],
    );
    expect(rows.rows[0]).toEqual({ snaps: 1, execs: 1, events: 2, audits: 1 });
    const stored = await h.admin.query(`SELECT data_hash FROM sf_forms.form_execution_record`);
    expect(JSON.stringify(stored.rows)).not.toContain('Lovelace');
  });

  it('CROSS_TENANT_LEAKAGE=0: tenant 2 cannot read or resolve tenant 1 data', async () => {
    const form = formFixture(T1);
    forms.publish(form);
    const created = await execute('t1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    const id = created.json().execution_id as string;
    const read = await app.inject({
      method: 'GET',
      url: `/v1/executions/${id}`,
      headers: bearer('t2'),
    });
    expect(read.statusCode).toBe(404);
    const useOther = await execute('t2', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(useOther.statusCode).toBe(404);
    const leaked = await asTenant(h.rt, T2, ACTOR, async (c) => {
      const a = await c.query('SELECT * FROM sf_forms.form_execution_record');
      const b = await c.query('SELECT * FROM sf_forms.form_definition_snapshot');
      const i = await c.query('SELECT * FROM sf_forms.idempotency_record');
      return (a.rowCount ?? 0) + (b.rowCount ?? 0) + (i.rowCount ?? 0);
    });
    expect(leaked).toBe(0);
  });

  it('without a tenant session the runtime sees no rows, and cannot write for another tenant', async () => {
    const none = await asTenant(h.rt, null, ACTOR, (c) =>
      c.query('SELECT * FROM sf_forms.form_execution_record'),
    );
    expect(none.rowCount).toBe(0);
    await expect(
      asTenant(h.rt, T2, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_forms.form_definition_snapshot (
             snapshot_id, tenant_id, cell_id, form_key, content_hash, payload_digest, payload, created_by
           ) VALUES ($1,$2,'cell-01','forged.form',$3,$3,'{}'::jsonb,$4)`,
          [randomUUID(), T1, `sha256:${'ee'.repeat(32)}`, ACTOR],
        ),
      ),
    ).rejects.toThrow();
  });

  it('isolated CMP-009 pair migrates up and down', async () => {
    await withIsolatedCmp009Database(h.admin, async (iso, migrateIso) => {
      migrateIso('up');
      const present = await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_forms'`);
      expect(present.rowCount).toBe(1);
      migrateIso('down', 2);
      const gone = await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_forms'`);
      expect(gone.rowCount).toBe(0);
    });
  });
});
