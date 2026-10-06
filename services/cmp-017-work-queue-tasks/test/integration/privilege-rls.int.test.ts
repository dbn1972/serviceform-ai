import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  closeHarness,
  pgCode,
  setupHarness,
  type Harness,
  type PgClient,
} from './helpers.js';
import { TENANT_A, TENANT_B, uuid } from '../doubles/fixtures.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => closeHarness(h));

const ASSIGN = [uuid(11), uuid(31)];

async function insertTask(c: PgClient, tenant: string, taskId: string, node = 'SCRUTINY') {
  await c.query(
    `INSERT INTO sf_tasks.human_task (tenant_id, task_id, application_id, workflow_node_id, cell_id,
       task_state, role_code, organisation_id, jurisdiction_id, created_by, correlation_id)
     VALUES ($1,$2,$3,$4,'cell-01','OPEN','SCRUTINY_OFFICER',$5,$6,$7,$8)`,
    [tenant, taskId, randomUUID(), node, ...ASSIGN, uuid(104), randomUUID()],
  );
}

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return pgCode(err);
  }
  return undefined;
}

describe('tenant isolation (FORCE RLS) for the component runtime login', () => {
  it('own-tenant DML succeeds; cross-tenant read/update/delete see nothing; cross-tenant insert fails', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertTask(c, TENANT_A, a));
    await asTenant(h.rt, TENANT_B, (c) => insertTask(c, TENANT_B, b));

    const seenByB = await asTenant(h.rt, TENANT_B, (c) =>
      c.query('SELECT task_id FROM sf_tasks.human_task'),
    );
    expect(seenByB.rows.map((r) => r['task_id'])).toEqual([b]);

    const upd = await asTenant(h.rt, TENANT_B, (c) =>
      c.query(`UPDATE sf_tasks.human_task SET task_state = 'CLAIMED' WHERE task_id = $1`, [a]),
    );
    expect(upd.rowCount).toBe(0);

    expect(
      await sqlState(
        asTenant(h.rt, TENANT_B, (c) => insertTask(c, TENANT_A, randomUUID(), 'OTHER')),
      ),
    ).toBe('42501');

    const noTenant = await asTenant(h.rt, null, (c) =>
      c.query('SELECT 1 FROM sf_tasks.human_task'),
    );
    expect(noTenant.rows).toHaveLength(0);
    expect(
      await sqlState(asTenant(h.rt, null, (c) => insertTask(c, TENANT_A, randomUUID(), 'NONE'))),
    ).toBe('42501');

    const stillA = await asTenant(h.rt, TENANT_A, (c) =>
      c.query('SELECT task_state FROM sf_tasks.human_task WHERE task_id = $1', [a]),
    );
    expect(stillA.rows[0]?.['task_state']).toBe('OPEN');
  });

  it('history, idempotency and outbox rows are tenant-bound too', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, async (c) => {
      await insertTask(c, TENANT_A, t, 'HIST');
      await c.query(
        `INSERT INTO sf_tasks.task_history (tenant_id, history_id, task_id, seq, operation, to_state,
           actor_type, actor_id, role_code, organisation_id, jurisdiction_id, authz_decision_id,
           policy_revision, idempotency_key, correlation_id)
         VALUES ($1,$2,$3,1,'CREATE','OPEN','SYSTEM',$4,'SCRUTINY_OFFICER',$5,$6,$7,'rev-1','history-key-1',$8)`,
        [TENANT_A, randomUUID(), t, uuid(104), ...ASSIGN, randomUUID(), randomUUID()],
      );
    });
    const other = await asTenant(h.rt, TENANT_B, (c) =>
      c.query('SELECT 1 FROM sf_tasks.task_history WHERE task_id = $1', [t]),
    );
    expect(other.rows).toHaveLength(0);
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_B, (c) =>
          c.query(
            `INSERT INTO sf_tasks.idempotency_record (tenant_id, principal_id, endpoint, idempotency_key,
               request_fingerprint, status, expires_at) VALUES ($1,$2,'POST /x','abcdefgh01',$3,'IN_PROGRESS',now())`,
            [TENANT_A, uuid(1), 'sha256:' + '0'.repeat(64)],
          ),
        ),
      ),
    ).toBe('42501');
  });
});

describe('component privilege boundary (ADR-0006)', () => {
  it('another component login cannot SELECT/INSERT/UPDATE/DELETE CMP-017 tables', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertTask(c, TENANT_A, t, 'XCOMP'));
    const statements = [
      'SELECT * FROM sf_tasks.human_task',
      'SELECT * FROM sf_tasks.task_history',
      'SELECT * FROM sf_tasks.idempotency_record',
      'DELETE FROM sf_tasks.human_task',
      'DELETE FROM sf_tasks.task_history',
      'DELETE FROM sf_tasks.idempotency_record',
    ];
    for (const sql of statements) {
      expect(await sqlState(asTenant(h.other, TENANT_A, (c) => c.query(sql))), sql).toBe('42501');
    }
    expect(
      await sqlState(
        asTenant(h.other, TENANT_A, (c) =>
          c.query(`UPDATE sf_tasks.human_task SET task_state = 'CLAIMED'`),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(
        asTenant(h.other, TENANT_A, (c) => insertTask(c, TENANT_A, randomUUID(), 'XCOMP2')),
      ),
    ).toBe('42501');
  });

  it('the CMP-017 login gains nothing beyond sf_app on any other component table', async () => {
    const { rows } = await h.admin.query(
      `SELECT n.nspname || '.' || c.relname AS tbl,
              c.oid::bigint AS oid
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname LIKE 'sf\\_%' AND n.nspname NOT IN ('sf_tasks', 'sf_platform')
          AND c.relkind IN ('r', 'p')`,
    );
    expect(rows.length).toBeGreaterThan(20);
    const diffs: string[] = [];
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      const r = await h.admin.query(
        `SELECT n.nspname || '.' || c.relname AS tbl
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname LIKE 'sf\\_%' AND n.nspname NOT IN ('sf_tasks', 'sf_platform') AND c.relkind IN ('r', 'p')
            AND has_table_privilege('sf_t017_rt', c.oid, $1) AND NOT has_table_privilege('sf_app', c.oid, $1)`,
        [priv],
      );
      diffs.push(...r.rows.map((x) => `${priv} ${String(x['tbl'])}`));
    }
    expect(diffs).toEqual([]);
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(`UPDATE sf_docintel.intelligence_job SET status = 'FAILED'`),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(asTenant(h.rt, TENANT_A, (c) => c.query(`DELETE FROM sf_audit.audit_event`))),
    ).toBe('42501');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) => c.query(`SELECT * FROM sf_ai_gateway.ai_policy`)),
      ),
    ).toBe('42501');
  });

  it('membership or SET ROLE into another component rw role is unavailable; no BYPASSRLS; not the owner', async () => {
    expect(
      await sqlState(asTenant(h.rt, TENANT_A, (c) => c.query('SET LOCAL ROLE sf_cmp048_rw'))),
    ).toBe('42501');
    const members = await h.admin.query(
      `SELECT r.rolname FROM pg_roles r WHERE r.rolname LIKE 'sf\\_cmp%\\_rw' AND r.rolname <> 'sf_cmp017_rw'
          AND pg_has_role('sf_t017_rt', r.oid, 'MEMBER')`,
    );
    expect(members.rows).toEqual([]);
    const me = await h.rt.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    expect(me.rows[0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
    const owner = await h.admin.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_tasks' AND pg_get_userbyid(c.relowner) = 'sf_t017_rt'`,
    );
    expect(owner.rows[0]?.['n']).toBe(0);
    expect(await sqlState(h.rt.query('CREATE TABLE sf_tasks.rogue (x int)'))).toBe('42501');
    expect(
      await sqlState(h.rt.query('ALTER TABLE sf_tasks.human_task ADD COLUMN named_officer text')),
    ).toBe('42501');
    expect(
      await sqlState(h.rt.query('ALTER TABLE sf_tasks.human_task DISABLE ROW LEVEL SECURITY')),
    ).toBe('42501');
  });
});

describe('database-enforced task invariants', () => {
  async function claimedTask(node: string): Promise<string> {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, async (c) => {
      await insertTask(c, TENANT_A, t, node);
      await c.query(
        `UPDATE sf_tasks.human_task SET task_state = 'CLAIMED', claimed_principal_id = $2, claimed_at = now(),
           aggregate_version = 2 WHERE task_id = $1`,
        [t, uuid(101)],
      );
    });
    return t;
  }

  it('completed and cancelled/closed tasks are immutable and cannot be reclaimed or deleted', async () => {
    const t = await claimedTask('TERM1');
    await asTenant(h.rt, TENANT_A, (c) =>
      c.query(
        `UPDATE sf_tasks.human_task SET task_state = 'COMPLETED', outcome = 'FORWARD_TO_APPROVAL', aggregate_version = 3 WHERE task_id = $1`,
        [t],
      ),
    );
    const reclaim = asTenant(h.rt, TENANT_A, (c) =>
      c.query(
        `UPDATE sf_tasks.human_task SET task_state = 'OPEN', claimed_principal_id = NULL, claimed_at = NULL, aggregate_version = 4 WHERE task_id = $1`,
        [t],
      ),
    );
    expect(await sqlState(reclaim)).toBe('P0001');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `UPDATE sf_tasks.human_task SET claimed_principal_id = $2, aggregate_version = 4 WHERE task_id = $1`,
            [t, uuid(102)],
          ),
        ),
      ),
    ).toBe('P0001');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query('DELETE FROM sf_tasks.human_task WHERE task_id = $1', [t]),
        ),
      ),
    ).toBe('42501');

    const closed = randomUUID();
    await asTenant(h.rt, TENANT_A, async (c) => {
      await insertTask(c, TENANT_A, closed, 'TERM2');
      await c.query(
        `UPDATE sf_tasks.human_task SET task_state = 'CANCELLED_CLOSED', outcome = 'CASE_WITHDRAWN', aggregate_version = 2 WHERE task_id = $1`,
        [closed],
      );
    });
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `UPDATE sf_tasks.human_task SET task_state = 'CLAIMED', claimed_principal_id = $2, claimed_at = now(), aggregate_version = 3 WHERE task_id = $1`,
            [closed, uuid(101)],
          ),
        ),
      ),
    ).toBe('P0001');
  });

  it('refuses illegal transitions, silent assignment change, version skips and identity edits', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertTask(c, TENANT_A, t, 'ILLEGAL'));
    const attempt = (sql: string, ...params: unknown[]) =>
      sqlState(asTenant(h.rt, TENANT_A, (c) => c.query(sql, [t, ...params])));
    expect(
      await attempt(
        `UPDATE sf_tasks.human_task SET task_state = 'COMPLETED', outcome = 'X_Y', claimed_principal_id = $2, aggregate_version = 2 WHERE task_id = $1`,
        uuid(101),
      ),
    ).toBe('P0001');
    expect(
      await attempt(
        `UPDATE sf_tasks.human_task SET task_state = 'CLAIMED', claimed_principal_id = $2, claimed_at = now(), organisation_id = $3, aggregate_version = 2 WHERE task_id = $1`,
        uuid(101),
        uuid(12),
      ),
    ).toBe('P0001');
    expect(
      await attempt(
        `UPDATE sf_tasks.human_task SET task_state = 'CLAIMED', claimed_principal_id = $2, claimed_at = now(), aggregate_version = 5 WHERE task_id = $1`,
        uuid(101),
      ),
    ).toBe('P0001');
    expect(
      await attempt(
        `UPDATE sf_tasks.human_task SET application_id = $2 WHERE task_id = $1`,
        uuid(9),
      ),
    ).toBe('42501');
    expect(
      await attempt(
        `UPDATE sf_tasks.human_task SET task_state = 'OPEN', aggregate_version = 2 WHERE task_id = $1`,
      ),
    ).toBe('P0001');
    expect(
      await attempt(
        `UPDATE sf_tasks.human_task SET task_state = 'CLAIMED', aggregate_version = 2 WHERE task_id = $1`,
      ),
    ).toBe('P0001');
  });

  it('assignment is criteria only: person-like role codes and a named_officer column are impossible', async () => {
    const bad = (role: string) =>
      sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `INSERT INTO sf_tasks.human_task (tenant_id, task_id, application_id, cell_id, task_state, role_code,
               organisation_id, jurisdiction_id, created_by, correlation_id)
             VALUES ($1,$2,$3,'cell-01','OPEN',$4,$5,$6,$7,$8)`,
            [TENANT_A, randomUUID(), randomUUID(), role, ...ASSIGN, uuid(104), randomUUID()],
          ),
        ),
      );
    expect(await bad('jane.doe')).toBe('23514');
    expect(await bad('Permanent Assignee')).toBe('23514');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(`INSERT INTO sf_tasks.human_task (tenant_id, named_officer) VALUES ($1, 'x')`, [
            TENANT_A,
          ]),
        ),
      ),
    ).toBe('42703');
  });

  it('task history is append-only and a second active task for a node is refused', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, async (c) => {
      await insertTask(c, TENANT_A, t, 'DUPNODE');
      await c.query(
        `INSERT INTO sf_tasks.task_history (tenant_id, history_id, task_id, seq, operation, to_state, actor_type,
           actor_id, role_code, organisation_id, jurisdiction_id, authz_decision_id, policy_revision,
           idempotency_key, correlation_id)
         VALUES ($1,$2,$3,1,'CREATE','OPEN','SYSTEM',$4,'SCRUTINY_OFFICER',$5,$6,$7,'rev-1','history-key-2',$8)`,
        [TENANT_A, randomUUID(), t, uuid(104), ...ASSIGN, randomUUID(), randomUUID()],
      );
    });
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(`UPDATE sf_tasks.task_history SET policy_revision = 'x' WHERE task_id = $1`, [t]),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(`DELETE FROM sf_tasks.task_history WHERE task_id = $1`, [t]),
        ),
      ),
    ).toBe('42501');
    const app = (
      await h.admin.query(`SELECT application_id FROM sf_tasks.human_task WHERE task_id = $1`, [t])
    ).rows[0]?.['application_id'];
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `INSERT INTO sf_tasks.human_task (tenant_id, task_id, application_id, workflow_node_id, cell_id, task_state,
               role_code, organisation_id, jurisdiction_id, created_by, correlation_id)
             VALUES ($1,$2,$3,'DUPNODE','cell-01','OPEN','SCRUTINY_OFFICER',$4,$5,$6,$7)`,
            [TENANT_A, randomUUID(), app, ...ASSIGN, uuid(104), randomUUID()],
          ),
        ),
      ),
    ).toBe('23505');
  });
});
