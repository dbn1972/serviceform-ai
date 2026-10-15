import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asTenant,
  closeHarness,
  OFFICER,
  randomUUID,
  resetData,
  setupHarness,
  T1,
  T2,
  withIsolatedDb,
  type Harness,
  type PgClient,
} from './helpers.js';

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

async function insertProject(c: PgClient, tenant: string, over: Partial<{ id: string }> = {}) {
  const id = over.id ?? randomUUID();
  await c.query(
    `INSERT INTO sf_migration.migration_project (
       tenant_id, project_id, display_name, source_system_ref, lifecycle_status,
       dry_run_required_before_execute, dry_run_count, idempotency_key, correlation_id,
       invented_statutory_policy_forbidden, created_by, created_at, updated_at
     ) VALUES ($1,$2,'Legacy Mig','LEGACY-SYS','CREATED',true,0,$3,$4,true,$5,now(),now())`,
    [tenant, id, `idem-${id.slice(0, 8)}`, randomUUID(), OFFICER],
  );
  return id;
}

describe('CMP-059 privilege boundary (ADR-0006), FORCE RLS and dry-run gate (INT-011/INT-017)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 180_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  beforeEach(async () => {
    await resetData(h.admin);
  });

  it('runtime role with sf_cmp059_rw can insert and read own tenant', async () => {
    const id = await asTenant(h.rt, T1, (c) => insertProject(c, T1));
    const rows = await asTenant(h.rt, T1, (c) =>
      c.query(
        `SELECT project_id, dry_run_required_before_execute, lifecycle_status
                 FROM sf_migration.migration_project WHERE project_id = $1`,
        [id],
      ),
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.['dry_run_required_before_execute']).toBe(true);
    expect(rows.rows[0]?.['lifecycle_status']).toBe('CREATED');
  });

  it('FORCE RLS hides T1 rows from T2 session', async () => {
    const id = await asTenant(h.rt, T1, (c) => insertProject(c, T1));
    const rows = await asTenant(h.rt, T2, (c) =>
      c.query(`SELECT project_id FROM sf_migration.migration_project WHERE project_id = $1`, [id]),
    );
    expect(rows.rowCount).toBe(0);
  });

  it('peer without sf_cmp059_rw is denied DML (42501)', async () => {
    const code = await denied(() => asTenant(h.peer, T1, (c) => insertProject(c, T1)));
    expect(code).toBe('42501');
  });

  it('CHECK rejects dry_run_required_before_execute=false', async () => {
    const code = await denied(() =>
      asTenant(h.rt, T1, async (c) => {
        await c.query(
          `INSERT INTO sf_migration.migration_project (
             tenant_id, project_id, display_name, source_system_ref, lifecycle_status,
             dry_run_required_before_execute, dry_run_count, idempotency_key, correlation_id,
             invented_statutory_policy_forbidden, created_by, created_at, updated_at
           ) VALUES ($1,$2,'X','SYS','CREATED',false,0,$3,$4,true,$5,now(),now())`,
          [T1, randomUUID(), 'idem-bad-dryrun', randomUUID(), OFFICER],
        );
      }),
    );
    expect(code).toBe('23514');
  });

  it('CHECK rejects invented_statutory_policy_forbidden=false', async () => {
    const code = await denied(() =>
      asTenant(h.rt, T1, async (c) => {
        await c.query(
          `INSERT INTO sf_migration.migration_project (
             tenant_id, project_id, display_name, source_system_ref, lifecycle_status,
             dry_run_required_before_execute, dry_run_count, idempotency_key, correlation_id,
             invented_statutory_policy_forbidden, created_by, created_at, updated_at
           ) VALUES ($1,$2,'X','SYS','CREATED',true,0,$3,$4,false,$5,now(),now())`,
          [T1, randomUUID(), 'idem-bad-statute', randomUUID(), OFFICER],
        );
      }),
    );
    expect(code).toBe('23514');
  });

  it('isolated chain migrates up and creates FORCE RLS tables', async () => {
    await withIsolatedDb(h.admin, async (iso, migrateIso) => {
      migrateIso('up');
      const check = await iso.query(
        `SELECT c.relname, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_migration'
            AND c.relname IN (
              'migration_project','source_profile','mapping_spec',
              'migration_batch','reconciliation_result','cutover_manifest',
              'idempotency_record','outbox_event'
            )
          ORDER BY c.relname`,
      );
      expect(check.rowCount).toBe(8);
      for (const row of check.rows) {
        expect(row['relforcerowsecurity']).toBe(true);
      }
    });
  });

  it('FORCE RLS hides T1 outbox_event rows from T2 session (REM outbox leakage)', async () => {
    await asTenant(h.rt, T1, async (c) => {
      await c.query(
        `INSERT INTO sf_migration.outbox_event
           (tenant_id, topic, event_type, payload, created_at)
         VALUES ($1, 'sf.migration', 'ProjectCreated', '{}'::jsonb, now())`,
        [T1],
      );
    });
    const t2 = await asTenant(h.rt, T2, (c) =>
      c.query(`SELECT event_id FROM sf_migration.outbox_event`),
    );
    expect(t2.rowCount).toBe(0);
    const t1 = await asTenant(h.rt, T1, (c) =>
      c.query(`SELECT event_id FROM sf_migration.outbox_event`),
    );
    expect(t1.rowCount).toBe(1);
  });
});
