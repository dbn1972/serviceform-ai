import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  CANARY,
  closeHarness,
  migrate,
  migrateDown,
  OFFICER,
  setupHarness,
  T1,
  T2,
  type Harness,
  type PgClientLike,
} from './helpers.js';

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

const BINDING = '77777777-7777-4777-8777-777777777777';

function insertDispatch(
  c: PgClientLike,
  tenant: string,
  id: string,
  over: Partial<{
    mode: string;
    env: string;
    critical: boolean;
    marker: string | null;
    key: string;
  }> = {},
) {
  const mode = over.mode ?? 'SIMULATED';
  const marker =
    over.marker === undefined
      ? mode === 'SIMULATED'
        ? JSON.stringify({ simulation: true })
        : null
      : over.marker;
  return c.query(
    `INSERT INTO sf_notification.notification_dispatch (
       tenant_id, dispatch_id, cell_id, template_ref, template_version, channel, locale,
       recipient_handle_class, recipient_handle_ref, connector_binding_id, connector_mode,
       connector_environment, connector_critical, simulation_marker, status, next_attempt_at,
       idempotency_key, requested_by, requested_at, correlation_id
     ) VALUES ($1,$2,'cell-01',$3,1,'SMS','en-IN','CITIZEN_HANDLE_REF','handle.demo.0001',$4,$5,$6,$7,$8::jsonb,
               'QUEUED',now(),$9,$10,now(),$11)`,
    [
      tenant,
      id,
      tenant === T2 ? CANARY : 'tpl.a',
      BINDING,
      mode,
      over.env ?? 'CI',
      over.critical ?? false,
      marker,
      over.key ?? `key-${id}`,
      OFFICER,
      randomUUID(),
    ],
  );
}

describe('CMP-025 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS, runtime login is not the owner', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('sf_cmp025_rw', 'sf_migrator', 'sf_t025_rt')`,
    );
    expect(roles.rows).toHaveLength(3);
    for (const r of roles.rows) {
      expect(r['rolsuper']).toBe(false);
      expect(r['rolbypassrls']).toBe(false);
      if (r['rolname'] !== 'sf_t025_rt') expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_notification' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.length).toBe(8);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) {
        expect(t['rls']).toBe(true);
        expect(t['forced']).toBe(true);
      }
    }
  });

  it('sf_app holds no DML on authoritative tables; a peer-component login is denied', async () => {
    const appDml = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_notification' AND grantee = 'sf_app'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')`,
    );
    expect(appDml.rows).toEqual([]);
    const code = await denied(() =>
      asTenant(h.other, T1, OFFICER, (c) => insertDispatch(c, T1, randomUUID())),
    );
    expect(code).not.toBe('allowed');
    const readCode = await denied(() =>
      asTenant(h.other, T1, OFFICER, (c) =>
        c.query('SELECT 1 FROM sf_notification.notification_dispatch'),
      ),
    );
    expect(readCode).not.toBe('allowed');
  });

  it('FORCE RLS hides the other tenant, refuses cross-tenant writes and a missing tenant context', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    await asTenant(h.rt, T1, OFFICER, (c) => insertDispatch(c, T1, id1));
    await asTenant(h.rt, T2, OFFICER, (c) => insertDispatch(c, T2, id2));
    const t1 = await asTenant(h.rt, T1, OFFICER, async (c) =>
      (await c.query('SELECT template_ref FROM sf_notification.notification_dispatch')).rows.map(
        (r) => r['template_ref'],
      ),
    );
    expect(t1).toEqual(['tpl.a']);
    expect(t1).not.toContain(CANARY);
    const none = await asTenant(
      h.rt,
      null,
      OFFICER,
      async (c) => (await c.query('SELECT 1 FROM sf_notification.notification_dispatch')).rows,
    );
    expect(none).toEqual([]);
    const crossWrite = await denied(() =>
      asTenant(h.rt, T1, OFFICER, (c) => insertDispatch(c, T2, randomUUID())),
    );
    expect(crossWrite).not.toBe('allowed');
    const crossUpdate = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(
        `UPDATE sf_notification.notification_dispatch SET attempts = 0 WHERE dispatch_id = $1`,
        [id2],
      ),
    );
    expect(crossUpdate.rowCount).toBe(0);
  });

  it('database refuses PRODUCTION-critical non-REAL, SIMULATED without marker, SIMULATED in UAT, REAL in CI', async () => {
    const cases: Parameters<typeof insertDispatch>[3][] = [
      { mode: 'SIMULATED', env: 'PRODUCTION', critical: true },
      { mode: 'SANDBOX', env: 'PRODUCTION', critical: true },
      { mode: 'SIMULATED', marker: null },
      { mode: 'SIMULATED', env: 'UAT' },
      { mode: 'REAL', env: 'CI', critical: false },
      { mode: 'REAL', marker: JSON.stringify({ simulation: true }), env: 'UAT' },
    ];
    for (const over of cases) {
      const code = await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) => insertDispatch(c, T1, randomUUID(), over)),
      );
      expect(code, JSON.stringify(over)).toBe('23514');
    }
    await asTenant(h.rt, T1, OFFICER, (c) =>
      insertDispatch(c, T1, randomUUID(), {
        mode: 'REAL',
        env: 'PRODUCTION',
        critical: true,
        marker: null,
      }),
    );
  });

  it('dispatch transitions are guarded; terminal rows, identity columns and deletes are refused', async () => {
    const id = randomUUID();
    await asTenant(h.rt, T1, OFFICER, (c) => insertDispatch(c, T1, id));
    const run = (sql: string) =>
      denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, [id])));
    const toSent = `UPDATE sf_notification.notification_dispatch
      SET status = 'SENT', sent_at = now(), aggregate_version = 2 WHERE dispatch_id = $1`;
    const sendingNoLease = `UPDATE sf_notification.notification_dispatch
      SET status = 'SENDING', aggregate_version = 2 WHERE dispatch_id = $1`;
    const sendingWrongVersion = `UPDATE sf_notification.notification_dispatch
      SET status = 'SENDING', lease_owner = 'w', lease_expires_at = now(), aggregate_version = 3
      WHERE dispatch_id = $1`;
    const sendingOk = `UPDATE sf_notification.notification_dispatch
      SET status = 'SENDING', lease_owner = 'w', lease_expires_at = now(), attempts = 1,
          aggregate_version = 2 WHERE dispatch_id = $1`;
    const toFailed = `UPDATE sf_notification.notification_dispatch
      SET status = 'FAILED', last_error_code = 'X1', lease_owner = NULL, lease_expires_at = NULL,
          aggregate_version = 3 WHERE dispatch_id = $1`;
    const reopen = `UPDATE sf_notification.notification_dispatch
      SET status = 'QUEUED', aggregate_version = 4 WHERE dispatch_id = $1`;
    expect(await run(toSent)).not.toBe('allowed');
    expect(await run(sendingNoLease)).not.toBe('allowed');
    expect(await run(sendingWrongVersion)).not.toBe('allowed');
    expect(await run(sendingOk)).toBe('allowed');
    expect(await run(toFailed)).toBe('allowed');
    expect(await run(reopen)).not.toBe('allowed');
    const idCode = await denied(() =>
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `UPDATE sf_notification.notification_dispatch SET channel = 'EMAIL' WHERE dispatch_id = $1`,
          [id],
        ),
      ),
    );
    expect(idCode).not.toBe('allowed');
    const del = await denied(() =>
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query('DELETE FROM sf_notification.notification_dispatch WHERE dispatch_id = $1', [id]),
      ),
    );
    expect(del).not.toBe('allowed');
  });

  it('published templates and attempts are insert-only; the runtime cannot rewrite identity columns', async () => {
    await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(
        `INSERT INTO sf_notification.notification_template (
           tenant_id, template_ref, template_version, channel, locale, body_template, allowed_params,
           published_by, published_at, correlation_id
         ) VALUES ($1,'tpl.imm',1,'SMS','en-IN','hello {{reference_no}}','{reference_no}',$2,now(),$3)`,
        [T1, OFFICER, randomUUID()],
      ),
    );
    for (const sql of [
      `UPDATE sf_notification.notification_template SET body_template = 'changed' WHERE template_ref = 'tpl.imm'`,
      `DELETE FROM sf_notification.notification_template WHERE template_ref = 'tpl.imm'`,
    ]) {
      expect(await denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql)))).not.toBe(
        'allowed',
      );
    }
    const id = randomUUID();
    await asTenant(h.rt, T1, OFFICER, async (c) => {
      await insertDispatch(c, T1, id);
      await c.query(
        `INSERT INTO sf_notification.dispatch_attempt (tenant_id, dispatch_id, attempt_no, outcome, connector_mode, simulation_marker, occurred_at, correlation_id)
         VALUES ($1,$2,1,'ACCEPTED','SIMULATED','{"simulation":true}'::jsonb,now(),$3)`,
        [T1, id, randomUUID()],
      );
    });
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `UPDATE sf_notification.dispatch_attempt SET outcome = 'PERMANENT_FAILURE' WHERE dispatch_id = $1`,
            [id],
          ),
        ),
      ),
    ).not.toBe('allowed');
  });

  it('isolated reversibility: down of CMP-025 migrations then up restores the schema', async () => {
    migrateDown(2);
    const missing = await h.admin.query(
      `SELECT 1 FROM pg_namespace WHERE nspname = 'sf_notification'`,
    );
    expect(missing.rows).toEqual([]);
    migrate();
    const present = await h.admin.query(
      `SELECT 1 FROM pg_namespace WHERE nspname = 'sf_notification'`,
    );
    expect(present.rows).toHaveLength(1);
    const role = await h.admin.query(
      `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp025_rw'`,
    );
    expect(role.rows[0]?.['rolcanlogin']).toBe(false);
  });
});
