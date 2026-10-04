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
  snapshotCombinedCatalog,
  T1,
  T2,
  withIsolatedCmp008Database,
  type Harness,
} from './helpers.js';
import { criteriaTable, forbiddenNodeGraph, packFixture, pinOf } from '../fixtures/packs.js';
import type { SimulatedRulePackPort } from '../../src/ports/rule-pack.js';

let h: Harness;
let app: FastifyInstance;
let packs: SimulatedRulePackPort;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

function evaluate(token: string, body: unknown, key = `k-${randomUUID()}`) {
  return app.inject({
    method: 'POST',
    url: '/v1/evaluations',
    headers: { ...bearer(token), 'idempotency-key': key },
    payload: body as object,
  });
}

beforeAll(async () => {
  h = await setupHarness();
  const built = await buildApp(h);
  app = built.app;
  packs = built.packs;
  installTenant('t1', T1);
  installTenant('t2', T2);
});
afterAll(async () => {
  await app?.close();
  await closeHarness(h);
});

describe('CMP-008 API + RLS integration (real PostgreSQL, real GoRules ZEN)', () => {
  it('evaluates for tenant 1 and persists snapshot, evaluation, outbox and audit rows', async () => {
    const pack = packFixture(T1);
    packs.publish(pack);
    const res = await evaluate('t1', {
      rule_pack: pinOf(pack),
      inputs: { score: 80 },
      purpose_code: 'ELIGIBILITY_CHECK',
      subject_ref: 'case-1',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.outcome).toBe('MEETS_CRITERIA');
    expect(body.reason_codes).toEqual(['ALPHA_THRESHOLD_MET', 'ZETA_THRESHOLD_MET']);
    const rows = await h.admin.query(
      `SELECT (SELECT count(*) FROM sf_rules.rule_pack_snapshot WHERE tenant_id = $1)::int AS snaps,
              (SELECT count(*) FROM sf_rules.evaluation_record WHERE tenant_id = $1)::int AS evals,
              (SELECT count(*) FROM sf_rules.outbox_event WHERE tenant_id = $1)::int AS events,
              (SELECT count(*) FROM sf_rules.outbox_event WHERE tenant_id = $1 AND topic = 'sf.audit.ingest.v1')::int AS audits`,
      [T1],
    );
    expect(rows.rows[0]).toEqual({ snaps: 1, evals: 1, events: 2, audits: 1 });
    const stored = await h.admin.query(
      `SELECT input_hash, outputs FROM sf_rules.evaluation_record`,
    );
    expect(JSON.stringify(stored.rows)).not.toContain('"score":80');
  });

  it('CROSS_TENANT_LEAKAGE=0: tenant 2 cannot read, resolve, or reference tenant 1 data', async () => {
    const pack = packFixture(T1);
    packs.publish(pack);
    const created = await evaluate('t1', {
      rule_pack: pinOf(pack),
      inputs: { score: 10 },
      purpose_code: 'ELIGIBILITY_CHECK',
    });
    const id = created.json().evaluation_id as string;
    const read = await app.inject({
      method: 'GET',
      url: `/v1/evaluations/${id}`,
      headers: bearer('t2'),
    });
    expect(read.statusCode).toBe(404);
    const useOtherPack = await evaluate('t2', {
      rule_pack: pinOf(pack),
      inputs: { score: 10 },
      purpose_code: 'ELIGIBILITY_CHECK',
    });
    expect(useOtherPack.statusCode).toBe(404);

    const leaked = await asTenant(h.rt, T2, ACTOR, async (c) => {
      const a = await c.query('SELECT * FROM sf_rules.evaluation_record');
      const b = await c.query('SELECT * FROM sf_rules.rule_pack_snapshot');
      const i = await c.query('SELECT * FROM sf_rules.idempotency_record');
      return (a.rowCount ?? 0) + (b.rowCount ?? 0) + (i.rowCount ?? 0);
    });
    expect(leaked).toBe(0);
  });

  it('without a tenant session the runtime sees no rows, and cannot write for another tenant', async () => {
    const none = await asTenant(h.rt, null, ACTOR, (c) =>
      c.query('SELECT * FROM sf_rules.evaluation_record'),
    );
    expect(none.rowCount).toBe(0);
    await expect(
      asTenant(h.rt, T2, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_rules.rule_pack_snapshot (
             snapshot_id, tenant_id, cell_id, pack_key, content_hash, payload_digest, payload, created_by
           ) VALUES ($1,$2,'cell-01','forged.pack',$3,$3,'{}'::jsonb,$4)`,
          [randomUUID(), T1, `sha256:${'ee'.repeat(32)}`, ACTOR],
        ),
      ),
    ).rejects.toThrow();
  });

  it('an evaluation cannot reference another tenant snapshot (composite FK)', async () => {
    const snap = await h.admin.query<{ snapshot_id: string }>(
      `SELECT snapshot_id FROM sf_rules.rule_pack_snapshot WHERE tenant_id = $1 LIMIT 1`,
      [T1],
    );
    await expect(
      asTenant(h.rt, T2, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_rules.evaluation_record (
             evaluation_id, tenant_id, cell_id, snapshot_id, pack_key, version_id, content_hash,
             input_hash, purpose_code, result_code, reason_codes, outputs, matched_rules,
             engine_name, engine_version, requested_by, evaluated_at
           ) VALUES ($1,$2,'cell-01',$3,'x.pack',$4,$5,$5,'P_CODE','NO_RULE_OUTPUT','[]','{}','[]','e','1',$6,now())`,
          [
            randomUUID(),
            T2,
            snap.rows[0]?.snapshot_id,
            randomUUID(),
            `sha256:${'11'.repeat(32)}`,
            ACTOR,
          ],
        ),
      ),
    ).rejects.toThrow();
  });

  it('replays by idempotency key without a second evaluation row', async () => {
    const pack = packFixture(T1);
    packs.publish(pack);
    const body = {
      rule_pack: pinOf(pack),
      inputs: { score: 55 },
      purpose_code: 'ELIGIBILITY_CHECK',
    };
    const first = await evaluate('t1', body, 'idem-int-1');
    const second = await evaluate('t1', body, 'idem-int-1');
    expect(second.statusCode).toBe(201);
    expect(second.json().evaluation_id).toBe(first.json().evaluation_id);
    const n = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_rules.evaluation_record WHERE content_hash = $1`,
      [pack.content_hash],
    );
    expect(n.rows[0]?.n).toBe(1);
    const conflict = await evaluate('t1', { ...body, inputs: { score: 1 } }, 'idem-int-1');
    expect(conflict.statusCode).toBe(409);
  });

  it('is deterministic and pinned: same pin and inputs -> same result; no match gives no default decision', async () => {
    const pack = packFixture(T1);
    packs.publish(pack);
    const req = {
      rule_pack: pinOf(pack),
      inputs: { score: 49 },
      purpose_code: 'ELIGIBILITY_CHECK',
    };
    const a = (await evaluate('t1', req)).json();
    const b = (await evaluate('t1', req)).json();
    for (const k of ['outcome', 'reason_codes', 'matched_rules', 'input_hash', 'result_code']) {
      expect(b[k]).toEqual(a[k]);
    }
    expect(a.outcome).toBe('DOES_NOT_MEET_CRITERIA');

    const table = criteriaTable();
    (table.nodes[1] as unknown as { content: { rules: unknown[] } }).content.rules = [
      { _id: 'r1', i1: '> 1000', o1: '"MEETS_CRITERIA"', o2: '["X_CODE"]' },
    ];
    const none = packFixture(T1, table, {}, 'generic.no-match');
    packs.publish(none);
    const res = await evaluate('t1', { ...req, rule_pack: pinOf(none) });
    expect(res.json().outcome).toBeNull();
    expect(res.json().result_code).toBe('NO_RULE_OUTPUT');
  });

  it('fails closed with nothing persisted for forbidden graphs and unauthorized callers', async () => {
    const before = await h.admin.query(`SELECT count(*)::int AS n FROM sf_rules.evaluation_record`);
    const bad = packFixture(T1, forbiddenNodeGraph('functionNode'), {}, 'generic.bad-graph');
    packs.publish(bad);
    const res = await evaluate('t1', {
      rule_pack: pinOf(bad),
      inputs: {},
      purpose_code: 'ELIGIBILITY_CHECK',
    });
    expect(res.statusCode).toBe(422);
    const noAuth = await app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: { 'idempotency-key': 'x' },
      payload: {},
    });
    expect(noAuth.statusCode).toBe(401);
    const after = await h.admin.query(`SELECT count(*)::int AS n FROM sf_rules.evaluation_record`);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('down migration is reversible (schema removed, role retained) and up restores it', async () => {
    const before = await snapshotCombinedCatalog(h.admin);
    expect(before.rulesPresent).toBe(true);
    expect(before.uploadTables.length).toBeGreaterThan(0);
    expect(before.migrationNames.some((n) => n.includes('cmp-013'))).toBe(true);
    expect(before.migrationNames.filter((n) => n.includes('cmp-008'))).toHaveLength(2);

    await withIsolatedCmp008Database(h.admin, async (iso, migrateIso) => {
      migrateIso('up');
      const applied = await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_rules'`);
      expect(applied.rowCount).toBe(1);
      migrateIso('down', 2);
      const gone = await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_rules'`);
      expect(gone.rowCount).toBe(0);
      const role = await iso.query<{
        rolcanlogin: boolean;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(`SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sf_cmp008_rw'`);
      expect(role.rowCount).toBe(1);
      expect(role.rows[0]).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false });
      migrateIso('up');
      const back = await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_rules'`);
      expect(back.rowCount).toBe(1);
    });

    const after = await snapshotCombinedCatalog(h.admin);
    expect(after).toEqual(before);
  });
});
