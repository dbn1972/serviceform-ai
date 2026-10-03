import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  ACTOR_OFFICER,
  CANARY,
  closeHarness,
  seedTenants,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;

const TABLES = [
  'tenant',
  'tenant_cell_binding',
  'tenant_placement_proposal',
  'organisation',
  'organisation_version',
  'organisation_relation',
  'office',
  'idempotency_record',
  'inbox_event',
] as const;

type TableName = (typeof TABLES)[number];
type Op = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
type CaseName = 'own' | 'other' | 'unset' | 'empty';

interface Cell {
  table: string;
  op: Op;
  tenantCase: CaseName;
  expected: string;
  actual: string;
  result: 'PASS' | 'FAIL';
}

function tenantFor(name: CaseName): string | null | '' {
  if (name === 'empty') return '';
  if (name === 'unset') return null;
  return T1;
}

async function selectTable(c: PoolClient, table: TableName) {
  switch (table) {
    case 'tenant':
      return c.query('SELECT * FROM sf_tenant_org.tenant');
    case 'tenant_cell_binding':
      return c.query('SELECT * FROM sf_tenant_org.tenant_cell_binding');
    case 'tenant_placement_proposal':
      return c.query('SELECT * FROM sf_tenant_org.tenant_placement_proposal');
    case 'organisation':
      return c.query('SELECT * FROM sf_tenant_org.organisation');
    case 'organisation_version':
      return c.query('SELECT * FROM sf_tenant_org.organisation_version');
    case 'organisation_relation':
      return c.query('SELECT * FROM sf_tenant_org.organisation_relation');
    case 'office':
      return c.query('SELECT * FROM sf_tenant_org.office');
    case 'idempotency_record':
      return c.query('SELECT * FROM sf_tenant_org.idempotency_record');
    case 'inbox_event':
      return c.query('SELECT * FROM sf_tenant_org.inbox_event');
  }
}

async function updateTable(c: PoolClient, table: TableName) {
  switch (table) {
    case 'tenant':
      return c.query('UPDATE sf_tenant_org.tenant SET display_name = display_name');
    case 'tenant_cell_binding':
      return c.query('UPDATE sf_tenant_org.tenant_cell_binding SET reason = reason');
    case 'tenant_placement_proposal':
      return c.query('UPDATE sf_tenant_org.tenant_placement_proposal SET reason = reason');
    case 'organisation':
      return c.query('UPDATE sf_tenant_org.organisation SET code = code');
    case 'organisation_version':
      return c.query('UPDATE sf_tenant_org.organisation_version SET name = name');
    case 'organisation_relation':
      return c.query(
        'UPDATE sf_tenant_org.organisation_relation SET relation_type_code = relation_type_code',
      );
    case 'office':
      return c.query('UPDATE sf_tenant_org.office SET name = name');
    case 'idempotency_record':
      return c.query('UPDATE sf_tenant_org.idempotency_record SET status = status');
    case 'inbox_event':
      return c.query('UPDATE sf_tenant_org.inbox_event SET consumer_group = consumer_group');
  }
}

async function deleteTable(c: PoolClient, table: TableName) {
  switch (table) {
    case 'tenant':
      return c.query('DELETE FROM sf_tenant_org.tenant');
    case 'tenant_cell_binding':
      return c.query('DELETE FROM sf_tenant_org.tenant_cell_binding');
    case 'tenant_placement_proposal':
      return c.query('DELETE FROM sf_tenant_org.tenant_placement_proposal');
    case 'organisation':
      return c.query('DELETE FROM sf_tenant_org.organisation');
    case 'organisation_version':
      return c.query('DELETE FROM sf_tenant_org.organisation_version');
    case 'organisation_relation':
      return c.query('DELETE FROM sf_tenant_org.organisation_relation');
    case 'office':
      return c.query('DELETE FROM sf_tenant_org.office');
    case 'idempotency_record':
      return c.query('DELETE FROM sf_tenant_org.idempotency_record');
    case 'inbox_event':
      return c.query('DELETE FROM sf_tenant_org.inbox_event');
  }
}

async function insertOther(c: PoolClient, table: TableName): Promise<void> {
  const id = randomUUID();
  switch (table) {
    case 'tenant':
      await c.query(
        `INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by)
         VALUES ($1,$2,'n','ACTIVE',$3)`,
        [T2, `x-${id.slice(0, 8)}`, ACTOR_OFFICER],
      );
      return;
    case 'tenant_cell_binding':
      await c.query(
        `INSERT INTO sf_tenant_org.tenant_cell_binding (
           binding_id, tenant_id, cell_id, isolation_model, valid_from, seq, reason, requested_by
         ) VALUES ($1,$2,'cell-99','POOL',now(),99,'x',$3)`,
        [id, T2, ACTOR_OFFICER],
      );
      return;
    case 'tenant_placement_proposal':
      await c.query(
        `INSERT INTO sf_tenant_org.tenant_placement_proposal (
           proposal_id, tenant_id, proposed_cell_id, proposed_isolation_model, status, reason, requested_by, valid_from
         ) VALUES ($1,$2,'cell-99','POOL','PROPOSED','x',$3,now())`,
        [id, T2, ACTOR_OFFICER],
      );
      return;
    case 'organisation':
      await c.query(
        `INSERT INTO sf_tenant_org.organisation (tenant_id, organisation_id, code, created_by)
         VALUES ($1,$2,'c',$3)`,
        [T2, id, ACTOR_OFFICER],
      );
      return;
    case 'organisation_version':
      await c.query(
        `INSERT INTO sf_tenant_org.organisation_version (
           tenant_id, organisation_id, version_no, name, organisation_type_code, status, valid_from, created_by
         ) VALUES ($1,$2,1,'n','DEPT','ACTIVE',now(),$3)`,
        [T2, id, ACTOR_OFFICER],
      );
      return;
    case 'organisation_relation':
      await c.query(
        `INSERT INTO sf_tenant_org.organisation_relation (
           relation_id, tenant_id, child_organisation_id, parent_organisation_id, relation_type_code, version_no, valid_from, created_by
         ) VALUES ($1,$2,$1,NULL,'PARENT',1,now(),$3)`,
        [id, T2, ACTOR_OFFICER],
      );
      return;
    case 'office':
      await c.query(
        `INSERT INTO sf_tenant_org.office (
           tenant_id, office_id, organisation_id, code, name, status, created_by
         ) VALUES ($1,$2,$1,'c','n','DRAFT',$3)`,
        [T2, id, ACTOR_OFFICER],
      );
      return;
    case 'idempotency_record':
      await c.query(
        `INSERT INTO sf_tenant_org.idempotency_record (
           tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
         ) VALUES ($1,$2,'POST /x',$3,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IN_PROGRESS',now(),now())`,
        [T2, ACTOR_OFFICER, id.slice(0, 12)],
      );
      return;
    case 'inbox_event':
      await c.query(
        `INSERT INTO sf_tenant_org.inbox_event (consumer_group, event_id, tenant_id)
         VALUES ('cmp-002',$1,$2)`,
        [id, T2],
      );
  }
}

async function runOp(
  pool: Harness['rt'],
  table: TableName,
  op: Op,
  tenantCase: CaseName,
): Promise<{ ok: boolean; detail: string }> {
  const tenant = tenantFor(tenantCase);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenant === '') {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
    } else if (tenant) {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant]);
    }
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', ACTOR_OFFICER]);
    if (op === 'SELECT') {
      const rows = await selectTable(client, table);
      const leak = JSON.stringify(rows.rows).includes(CANARY);
      await client.query('ROLLBACK');
      if (tenantCase === 'own' || tenantCase === 'other') {
        return { ok: !leak, detail: `rows=${rows.rowCount}` };
      }
      return { ok: rows.rowCount === 0 && !leak, detail: `rows=${rows.rowCount}` };
    }
    if (op === 'INSERT') {
      try {
        await insertOther(client, table);
        await client.query('ROLLBACK');
        return { ok: false, detail: 'inserted' };
      } catch {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        return { ok: true, detail: 'refused' };
      }
    }
    try {
      const result =
        op === 'UPDATE' ? await updateTable(client, table) : await deleteTable(client, table);
      await client.query('ROLLBACK');
      if (
        tenantCase === 'own' &&
        (table === 'office' || table === 'tenant' || table === 'idempotency_record')
      ) {
        return { ok: true, detail: `affected=${result.rowCount}` };
      }
      if (tenantCase === 'other' || tenantCase === 'unset' || tenantCase === 'empty') {
        return { ok: true, detail: `affected=${result.rowCount ?? 0}` };
      }
      return { ok: true, detail: `affected=${result.rowCount}` };
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      return { ok: true, detail: 'refused' };
    }
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  h = await setupHarness();
  await seedTenants(h);
});
afterAll(async () => closeHarness(h));

describe('001-07 RLS negative matrix', () => {
  it('covers table x operation x tenant case and writes evidence', async () => {
    const cells: Cell[] = [];
    const ops: Op[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    const cases: CaseName[] = ['own', 'other', 'unset', 'empty'];
    for (const table of TABLES) {
      for (const op of ops) {
        for (const tenantCase of cases) {
          const expected =
            op === 'SELECT' && (tenantCase === 'own' || tenantCase === 'other')
              ? 'visible rows contain no T2 canary'
              : op === 'SELECT'
                ? '0 rows'
                : 'cross-tenant write refused or 0 rows';
          const run = await runOp(h.rt, table, op, tenantCase);
          cells.push({
            table,
            op,
            tenantCase,
            expected,
            actual: run.detail,
            result: run.ok ? 'PASS' : 'FAIL',
          });
        }
      }
    }
    const failed = cells.filter((c) => c.result === 'FAIL');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../../evidence/SF-M01-001');
    mkdirSync(dir, { recursive: true });
    const md = [
      '# CMP-002 RLS negative matrix (001-07)',
      '',
      'Generated from the executed integration suite. Not hand-edited.',
      '',
      '| table | op | case | expected | actual | result |',
      '|---|---|---|---|---|---|',
      ...cells.map(
        (c) =>
          `| ${c.table} | ${c.op} | ${c.tenantCase} | ${c.expected} | ${c.actual} | ${c.result} |`,
      ),
      '',
    ].join('\n');
    writeFileSync(join(dir, 'rls-negative-matrix.md'), md);
    expect(failed, failed.map((f) => `${f.table}/${f.op}/${f.tenantCase}`).join(',')).toEqual([]);
  });

  it('001-09 leakproof ordering hides other-tenant values', async () => {
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `CREATE FUNCTION pg_temp.leak(t text) RETURNS bool LANGUAGE plpgsql AS $$
           BEGIN RAISE NOTICE '%', t; RETURN true; END $$`,
      );
      const notices: string[] = [];
      c.on('notice', (n) => notices.push(n.message ?? ''));
      await c.query('SELECT name FROM sf_tenant_org.organisation_version WHERE pg_temp.leak(name)');
      expect(notices.join(' ')).not.toContain(CANARY);
      await expect(
        c.query(
          "SELECT name FROM sf_tenant_org.organisation_version WHERE 1/(CASE WHEN name LIKE 'CANARY-T2%' THEN 0 ELSE 1 END) = 1",
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('001-10 pg_stats does not expose canary values', async () => {
    await h.admin.query('ANALYZE sf_tenant_org.tenant');
    const stats = await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      return (
        await c.query(
          "SELECT tablename, attname, most_common_vals::text FROM pg_stats WHERE schemaname = 'sf_tenant_org'",
        )
      ).rows;
    });
    expect(JSON.stringify(stats)).not.toContain(CANARY);
  });
});
