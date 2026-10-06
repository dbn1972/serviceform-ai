import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TemporalSequencingAdapter,
  WorkflowService,
  applyResult,
  startInstance,
  type WorkflowVersionRecord,
} from '../../src/index.js';
import { Approvals, Authz, RecordingTemporal, ctx } from '../doubles/ports.js';
import { ACTOR, CHECKER, T1, T2, linearGraph, richGraph } from '../fixtures/models.js';
import {
  PEER_ROLE,
  RUNTIME_ROLE,
  asSqlPool,
  asTenant,
  closeHarness,
  errorOf,
  setupHarness,
  type Harness,
} from './helpers.js';

const APP_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const APP_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const TABLES = [
  'workflow_definition',
  'workflow_version',
  'migration_plan',
  'workflow_instance',
  'workflow_request',
  'idempotency_record',
  'outbox_event',
  'inbox_event',
];

const INSERT_INSTANCE = `INSERT INTO sf_workflow.workflow_instance (instance_id, tenant_id, cell_id,
  application_id, workflow_version_id, graph_hash, temporal_workflow_id, status, active_nodes)
  VALUES ($1, $2, 'cell-local-1', $3, $4, $5, $6, 'RUNNING', '[]')`;

function instanceParams(versionId: string, hash: string): string[] {
  const app = randomUUID();
  return [randomUUID(), T1, app, versionId, hash, `sf-wf:${T1}:${app}`];
}

let h: Harness;
let svc: WorkflowService;
let temporal: RecordingTemporal;
const seeded: Record<
  string,
  { v1: WorkflowVersionRecord; v2: WorkflowVersionRecord; app: string }
> = {};

async function seedTenant(tenant: string, app: string, key: string) {
  const c = ctx({ tenant_id: tenant });
  const { definition_id } = await svc.createDefinition(c, { definition_key: key });
  const d1 = await svc.createDraft(c, { definition_id, graph: richGraph() });
  const v1 = await svc.publish(c, { version_id: d1.version_id, approval_ref: 'mc:approval:1' });
  const d2 = await svc.createDraft(c, { definition_id, graph: linearGraph() });
  const v2 = await svc.publish(c, { version_id: d2.version_id, approval_ref: 'mc:approval:2' });
  await svc.startInstance(c, { application_id: app, workflow_version_id: v1.version_id });
  const s = applyResult(v1.model, startInstance(v1.model).state, {
    node_id: 'ELIGIBILITY',
    kind: 'RULE',
    outcome: 'ELIGIBLE',
  });
  await svc.recordProgress(c, { application_id: app, state: s.state, last_signal_id: null });
  await svc.submitRequest(c, {
    application_id: app,
    request_kind: 'WITHDRAWAL',
    outcome: 'CITIZEN_WITHDRAW',
    idempotency_key: `idem-${key}-01`,
  });
  return { v1, v2, app };
}

beforeAll(async () => {
  h = await setupHarness();
  temporal = new RecordingTemporal();
  svc = new WorkflowService({
    pool: asSqlPool(h.rt),
    authz: new Authz(),
    approvals: new Approvals(),
    temporal: new TemporalSequencingAdapter(temporal, 'sf-workflow'),
  });
  seeded[T1] = await seedTenant(T1, APP_A, 'tenant.a.flow');
  seeded[T2] = await seedTenant(T2, APP_B, 'tenant.b.flow');
});

afterAll(async () => {
  await closeHarness(h);
});

describe('FORCE RLS tenant isolation on real PostgreSQL (CROSS_TENANT_LEAKAGE=0)', () => {
  it('every sf_workflow tenant table has RLS enabled and forced', async () => {
    const r = await h.admin.query<{ relname: string; on: boolean; forced: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS on, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_workflow' AND c.relkind = 'r' AND c.relname = ANY($1)`,
      [TABLES],
    );
    expect(r.rows).toHaveLength(TABLES.length);
    for (const row of r.rows) expect(row, row.relname).toMatchObject({ on: true, forced: true });
  });

  it('each tenant sees only its own rows in every table; leakage count is zero', async () => {
    let leakage = 0;
    for (const [mine, other] of [
      [T1, T2],
      [T2, T1],
    ] as const) {
      for (const t of TABLES.filter((x) => x !== 'outbox_event')) {
        const rows = await asTenant(h.rt, mine, (q) =>
          q<{ tenant_id: string }>(`SELECT tenant_id FROM sf_workflow.${t}`),
        );
        leakage += rows.rows.filter((r) => r.tenant_id === other).length;
      }
    }
    const own = await asTenant(h.rt, T1, (q) => q('SELECT 1 FROM sf_workflow.workflow_version'));
    expect(own.rowCount).toBe(2);
    expect(leakage).toBe(0);
  });

  it('without tenant context every table returns nothing (fail closed)', async () => {
    for (const t of TABLES.filter((x) => x !== 'outbox_event')) {
      const r = await asTenant(h.rt, null, (q) => q(`SELECT 1 FROM sf_workflow.${t}`));
      expect(r.rowCount, t).toBe(0);
    }
  });

  it('IDOR: tenant A cannot read, update or bind to tenant B records by id', async () => {
    const b = seeded[T2] as { v1: WorkflowVersionRecord; app: string };
    const read = await asTenant(h.rt, T1, (q) =>
      q('SELECT 1 FROM sf_workflow.workflow_version WHERE version_id = $1', [b.v1.version_id]),
    );
    expect(read.rowCount).toBe(0);
    const upd = await asTenant(h.rt, T1, (q) =>
      q(`UPDATE sf_workflow.workflow_instance SET status = 'FAULTED' WHERE application_id = $1`, [
        b.app,
      ]),
    );
    expect(upd.rowCount).toBe(0);
    const bind = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q(INSERT_INSTANCE, instanceParams(b.v1.version_id, b.v1.model.graph_hash)),
      ),
    );
    expect(bind.code).toMatch(/^(23503|P0001)$/);
  });

  it('refuses writing a row for another tenant (WITH CHECK)', async () => {
    const e = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q(
          `INSERT INTO sf_workflow.workflow_definition (definition_id, tenant_id, cell_id, definition_key, created_by)
           VALUES (gen_random_uuid(), $1, 'cell-local-1', 'cross.tenant', $2)`,
          [T2, ACTOR],
        ),
      ),
    );
    expect(e.message).toMatch(/row-level security/);
  });

  it('service layer: tenant B cannot export, start, signal or request on tenant A data', async () => {
    const a = seeded[T1] as { v1: WorkflowVersionRecord; app: string };
    const b = ctx({ tenant_id: T2 });
    const codes: string[] = [];
    // Lazy: each promise is created only when awaited, so none can reject before errorOf attaches.
    const calls: (() => Promise<unknown>)[] = [
      () => svc.exportBpmn(b, a.v1.version_id),
      () => svc.startInstance(b, { application_id: a.app, workflow_version_id: a.v1.version_id }),
      () =>
        svc.submitRequest(b, {
          application_id: a.app,
          request_kind: 'CANCELLATION',
          outcome: 'ADMIN_CANCEL',
          idempotency_key: 'idem-xt-0002',
        }),
    ];
    for (const call of calls) {
      codes.push(((await errorOf(call())) as { code?: string }).code ?? '');
    }
    expect(codes).toEqual(['SF-SYS-002', 'SF-SYS-002', 'SF-SYS-002']);
  });
});

describe('ADR-0006 privilege boundary for the CMP-016 runtime login', () => {
  it('runtime login is not superuser, cannot bypass RLS and inherits only sf_app + sf_cmp016_rw', async () => {
    const r = await h.admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [RUNTIME_ROLE],
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const groups = await h.admin.query<{ g: string }>(
      `SELECT g.rolname AS g FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
        JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1 ORDER BY 1`,
      [RUNTIME_ROLE],
    );
    expect(groups.rows.map((x) => x.g)).toEqual(['sf_app', 'sf_cmp016_rw']);
    const role = await h.admin.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp016_rw'`);
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
  });

  it('runtime login owns no sf_workflow table, schema or function', async () => {
    const r = await h.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'sf_workflow' AND pg_get_userbyid(c.relowner) IN ($1, 'sf_cmp016_rw', 'sf_app')`,
      [RUNTIME_ROLE],
    );
    expect(r.rows[0]?.n).toBe(0);
    const s = await h.admin.query<{ o: string }>(
      `SELECT pg_get_userbyid(nspowner) AS o FROM pg_namespace WHERE nspname = 'sf_workflow'`,
    );
    expect(s.rows[0]?.o).toBe('sf_migrator');
  });

  it('own authorized DML succeeds through the real login', async () => {
    const r = await asTenant(h.rt, T1, (q) =>
      q<{ n: number }>('SELECT count(*)::int AS n FROM sf_workflow.workflow_instance'),
    );
    expect(r.rows[0]?.n).toBe(1);
  });

  it('NEGATIVE: cross-component authoritative SQL is denied (CMP-016 -> other schemas)', async () => {
    const schemas = await h.admin.query<{ s: string }>(
      `SELECT nspname AS s FROM pg_namespace WHERE nspname LIKE 'sf\\_%' ESCAPE '\\'
         AND nspname NOT IN ('sf_workflow', 'sf_platform') ORDER BY 1`,
    );
    expect(schemas.rows.length).toBeGreaterThan(5);
    let readable = 0;
    for (const { s } of schemas.rows) {
      const tables = await h.admin.query<{ t: string }>(
        `SELECT relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind = 'r'`,
        [s],
      );
      for (const { t } of tables.rows) {
        const can = await h.admin.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS sel, has_table_privilege($1, $2, 'INSERT') AS ins,
                  has_table_privilege($1, $2, 'UPDATE') AS upd, has_table_privilege($1, $2, 'DELETE') AS del`,
          [RUNTIME_ROLE, `${s}.${t}`],
        );
        const p = can.rows[0] as { sel: boolean; ins: boolean; upd: boolean; del: boolean };
        // SF-CON-OUTBOX (frozen) grants INSERT on outbox/inbox tables to sf_app; not authoritative state.
        const frozenOutboxGrant = /^(outbox|inbox)_event/.test(t);
        if (p.upd || p.del || (p.sel && !frozenOutboxGrant) || (p.ins && !frozenOutboxGrant)) {
          readable += 1;
        }
      }
    }
    expect(readable).toBe(0);
    const e = await errorOf(
      asTenant(h.rt, T1, (q) => q('SELECT 1 FROM sf_rules.evaluation_record')),
    );
    expect(e.code).toBe('42501');
    const e2 = await errorOf(
      asTenant(h.rt, T1, (q) => q('UPDATE sf_rules.rule_pack_snapshot SET pack_key = pack_key')),
    );
    expect(e2.code).toBe('42501');
  });

  it('NEGATIVE: runtime login cannot SET ROLE into another component role', async () => {
    const e = await errorOf(asTenant(h.rt, T1, (q) => q('SET ROLE sf_cmp008_rw')));
    expect(e.code).toBe('42501');
  });

  it('NEGATIVE: another component login cannot read or write sf_workflow authoritative tables', async () => {
    for (const sql of [
      'SELECT 1 FROM sf_workflow.workflow_version',
      'SELECT 1 FROM sf_workflow.workflow_instance',
      `UPDATE sf_workflow.workflow_instance SET status = 'FAULTED'`,
      'DELETE FROM sf_workflow.workflow_request',
      `INSERT INTO sf_workflow.workflow_definition (definition_id, tenant_id, cell_id, definition_key, created_by)
         VALUES (gen_random_uuid(), '${T1}', 'cell-local-1', 'peer.write', '${ACTOR}')`,
    ]) {
      const e = await errorOf(asTenant(h.peer, T1, (q) => q(sql)));
      expect(e.code, `${PEER_ROLE}: ${sql}`).toBe('42501');
    }
  });

  it('NEGATIVE: CMP-016 cannot run DDL in its schema', async () => {
    const e = await errorOf(asTenant(h.rt, T1, (q) => q('CREATE TABLE sf_workflow.x (id int)')));
    expect(e.code).toBe('42501');
  });
});

describe('DB trigger negatives: immutability and no silent version retarget', () => {
  const t1 = () =>
    seeded[T1] as { v1: WorkflowVersionRecord; v2: WorkflowVersionRecord; app: string };

  it('NEGATIVE: a published version model/hash cannot be mutated even by direct SQL', async () => {
    for (const sql of [
      `UPDATE sf_workflow.workflow_version SET model = jsonb_set(model, '{immutable}', 'false') WHERE version_id = $1`,
      `UPDATE sf_workflow.workflow_version SET graph_hash = 'sha256:' || repeat('0', 64) WHERE version_id = $1`,
      `UPDATE sf_workflow.workflow_version SET publication_approval_ref = 'other' WHERE version_id = $1`,
      `UPDATE sf_workflow.workflow_version SET status = 'DRAFT' WHERE version_id = $1`,
    ]) {
      const e = await errorOf(asTenant(h.rt, T1, (q) => q(sql, [t1().v1.version_id])));
      expect(e.hint, sql).toMatch(/^SF_(PUBLISHED_IMMUTABLE|VERSION_TRANSITION)$/);
    }
    const del = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q('DELETE FROM sf_workflow.workflow_version WHERE version_id = $1', [t1().v1.version_id]),
      ),
    );
    expect(del.hint).toBe('SF_PUBLISHED_IMMUTABLE');
    const vno = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q('UPDATE sf_workflow.workflow_version SET version_no = 99 WHERE version_id = $1', [
          t1().v1.version_id,
        ]),
      ),
    );
    expect(vno.code).toBe('42501');
  });

  it('NEGATIVE: an instance cannot start on a draft or with a mismatched graph hash', async () => {
    const c = ctx();
    const { definition_id } = await svc.createDefinition(c, { definition_key: 'tenant.a.draft' });
    const draft = await svc.createDraft(c, { definition_id, graph: linearGraph() });
    for (const [version, hash] of [
      [draft.version_id, draft.model.graph_hash],
      [t1().v2.version_id, t1().v1.model.graph_hash],
    ] as const) {
      const e = await errorOf(
        asTenant(h.rt, T1, (q) => q(INSERT_INSTANCE, instanceParams(version, hash))),
      );
      expect(e.hint).toBe('SF_VERSION_NOT_PUBLISHED');
    }
  });

  it('NEGATIVE: the pinned version cannot be silently retargeted without an approved plan', async () => {
    const { v1, v2, app } = t1();
    const silent = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q(
          'UPDATE sf_workflow.workflow_instance SET workflow_version_id = $2, graph_hash = $3 WHERE application_id = $1',
          [app, v2.version_id, v2.model.graph_hash],
        ),
      ),
    );
    expect(silent.hint).toBe('SF_SILENT_REPOINT');
    const plan = await svc.approveMigration(ctx(), {
      from_version_id: v1.version_id,
      to_version_id: v2.version_id,
      node_mapping: { SCRUTINY: 'REVIEW' },
      approval_ref: 'mc:migration:1',
      simulation_evidence_ref: 'evidence/simulation/1',
      requested_by: ACTOR,
    });
    expect(plan.approved_by).toBe(CHECKER);
    const wrongTarget = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q(
          `UPDATE sf_workflow.workflow_instance SET workflow_version_id = $2, graph_hash = $3, migration_id = $4
            WHERE application_id = $1`,
          [app, v2.version_id, v1.model.graph_hash, plan.migration_id],
        ),
      ),
    );
    expect(wrongTarget.hint).toBe('SF_SILENT_REPOINT');
    const planEdit = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q(`UPDATE sf_workflow.migration_plan SET approval_ref = 'x' WHERE migration_id = $1`, [
          plan.migration_id,
        ]),
      ),
    );
    expect(planEdit.code).toBe('42501');
  });

  it('a migration plan cannot target an unpublished or foreign-definition version', async () => {
    const c = ctx();
    const { definition_id } = await svc.createDefinition(c, { definition_key: 'tenant.a.other' });
    const d = await svc.createDraft(c, { definition_id, graph: linearGraph() });
    const e = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q(
          `INSERT INTO sf_workflow.migration_plan (migration_id, tenant_id, from_version_id, to_version_id,
             node_mapping, approval_ref, simulation_evidence_ref, requested_by, approved_by)
           VALUES (gen_random_uuid(), $1, $2, $3, '{}', 'mc:1', 'evidence/sim', $4, $5)`,
          [T1, t1().v1.version_id, d.version_id, ACTOR, CHECKER],
        ),
      ),
    );
    expect(e.hint).toBe('SF_MIGRATION_INVALID');
  });

  it('a resolved workflow request and a terminal instance cannot be reopened', async () => {
    const { app } = t1();
    await asTenant(h.rt, T1, (q) =>
      q(`UPDATE sf_workflow.workflow_request SET status = 'REJECTED' WHERE application_id = $1`, [
        app,
      ]),
    );
    const reopen = await errorOf(
      asTenant(h.rt, T1, (q) =>
        q(
          `UPDATE sf_workflow.workflow_request SET status = 'PENDING_REVIEW' WHERE application_id = $1`,
          [app],
        ),
      ),
    );
    expect(reopen.hint).toBe('SF_RECORD_IMMUTABLE');
    const del = await errorOf(
      asTenant(h.rt, T1, (q) => q('DELETE FROM sf_workflow.workflow_instance')),
    );
    expect(del.code).toBe('42501');
  });
});
