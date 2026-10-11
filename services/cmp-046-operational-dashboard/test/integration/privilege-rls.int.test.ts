import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  closeHarness,
  MIGRATION_FILES,
  OFFICER,
  RUNTIME_ROLE,
  setupHarness,
  T1,
  T2,
  withIsolatedDatabase,
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

function insertSnapshot(
  c: PgClient,
  tenant: string,
  over: Partial<{
    view: string;
    source: string;
    status: string;
    nonAuth: boolean;
    version: number;
    asOf: string | null;
  }> = {},
): Promise<unknown> {
  const asOf = over.asOf === undefined ? new Date().toISOString() : over.asOf;
  return c.query(
    `INSERT INTO sf_ops_dashboard.ops_view_snapshot (
       tenant_id, snapshot_id, view_code, source_component, status, metrics, as_of, last_attempt_at,
       snapshot_version, non_authoritative
     ) VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6,now(),$7,$8)`,
    [
      tenant,
      randomUUID(),
      over.view ?? 'SLA_SUMMARY',
      over.source ?? 'CMP-029',
      over.status ?? 'OK',
      asOf,
      over.version ?? 1,
      over.nonAuth ?? true,
    ],
  );
}

describe('CMP-046 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 180_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS, tables owned by sf_migrator with FORCE RLS', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [['sf_cmp046_rw', 'sf_migrator', RUNTIME_ROLE]],
    );
    expect(roles.rows).toHaveLength(3);
    for (const r of roles.rows) {
      expect(r['rolsuper']).toBe(false);
      expect(r['rolbypassrls']).toBe(false);
      if (r['rolname'] !== RUNTIME_ROLE) expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_ops_dashboard' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.map((t) => t['relname'])).toEqual([
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'ops_view_refresh_log',
      'ops_view_snapshot',
      'outbox_event',
      'outbox_event_platform',
    ]);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) {
        expect(t['rls'], String(t['relname'])).toBe(true);
        expect(t['forced'], String(t['relname'])).toBe(true);
      }
    }
  });

  it('sf_app holds no DML on read-model tables; a peer privilege role cannot write them', async () => {
    const appDml = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_ops_dashboard' AND grantee = 'sf_app'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')`,
    );
    expect(appDml.rows).toEqual([]);
    expect(
      await denied(() => asTenant(h.peer, T1, OFFICER, (c) => insertSnapshot(c, T1))),
    ).not.toBe('allowed');
    expect(
      await denied(() =>
        asTenant(h.peer, T1, OFFICER, (c) =>
          c.query('SELECT 1 FROM sf_ops_dashboard.ops_view_snapshot'),
        ),
      ),
    ).not.toBe('allowed');
  });

  it('holds no table privilege on peer component schemas (no case / SLA / queue access)', async () => {
    const peers = await h.admin.query<{ s: string }>(
      `SELECT format('%I.%I', n.nspname, c.relname) AS s
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('sf_sla','sf_application_case','sf_work_queue','sf_event_bus','sf_integration_hub')
          AND c.relname !~ '^(outbox|inbox)_event'`,
    );
    expect(peers.rows.length).toBeGreaterThan(0);
    for (const { s: table } of peers.rows) {
      const ok = await h.admin.query<{ ok: boolean }>(
        `SELECT has_table_privilege($1, $2::regclass, 'SELECT,INSERT,UPDATE,DELETE') AS ok`,
        [RUNTIME_ROLE, table],
      );
      expect(ok.rows[0]?.ok, table).toBe(false);
    }
    const crossGrants = await h.admin.query(
      `SELECT table_schema, table_name FROM information_schema.role_table_grants
        WHERE grantee = 'sf_cmp046_rw' AND table_schema <> 'sf_ops_dashboard'`,
    );
    expect(crossGrants.rows).toEqual([]);
  });

  it('FORCE RLS hides the other tenant; a session with no tenant sees nothing and cannot write', async () => {
    await asTenant(h.rt, T1, OFFICER, (c) => insertSnapshot(c, T1));
    await asTenant(h.rt, T2, OFFICER, (c) =>
      insertSnapshot(c, T2, { view: 'EVENT_HEALTH', source: 'CMP-038' }),
    );
    const t1 = await asTenant(h.rt, T1, OFFICER, async (c) =>
      (await c.query('SELECT view_code FROM sf_ops_dashboard.ops_view_snapshot')).rows.map(
        (r) => r['view_code'],
      ),
    );
    expect(t1).toEqual(['SLA_SUMMARY']);
    const none = await asTenant(
      h.rt,
      null,
      OFFICER,
      async (c) => (await c.query('SELECT view_code FROM sf_ops_dashboard.ops_view_snapshot')).rows,
    );
    expect(none).toEqual([]);
    expect(await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertSnapshot(c, T2)))).not.toBe(
      'allowed',
    );
    expect(
      await denied(() => asTenant(h.rt, null, OFFICER, (c) => insertSnapshot(c, T1))),
    ).not.toBe('allowed');
  });

  it('database refuses authoritative drift: wrong source, non-authoritative=false, bad status, OK without as_of', async () => {
    const bad: Parameters<typeof insertSnapshot>[2][] = [
      { view: 'SLA_SUMMARY', source: 'CMP-015' },
      { view: 'SLA_SUMMARY', source: 'CMP-037' },
      { view: 'CASE_APPROVALS', source: 'CMP-029' },
      { nonAuth: false },
      { status: 'GREEN' },
      { status: 'OK', asOf: null },
      { version: 0 },
    ];
    for (const [i, over] of bad.entries()) {
      const code = await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          insertSnapshot(c, T1, { view: 'QUEUE_SUMMARY', source: 'CMP-017', ...over }),
        ),
      );
      expect(code, `case ${i}`).toBe('23514');
    }
  });

  it('guard triggers: snapshots are never deleted, identity is immutable, version advances by one, refresh log is insert-only', async () => {
    const id = randomUUID();
    await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(
        `INSERT INTO sf_ops_dashboard.ops_view_snapshot (tenant_id, snapshot_id, view_code, source_component, status, metrics, as_of, last_attempt_at, snapshot_version)
         VALUES ($1,$2,'PLATFORM_HEALTH','CMP-047','OK','[]'::jsonb, now(), now(), 1)`,
        [T1, id],
      ),
    );
    const UPDATES = {
      skipVersion:
        'UPDATE sf_ops_dashboard.ops_view_snapshot SET snapshot_version = 3 WHERE tenant_id = $1 AND snapshot_id = $2',
      sameVersion:
        "UPDATE sf_ops_dashboard.ops_view_snapshot SET status = 'DEGRADED' WHERE tenant_id = $1 AND snapshot_id = $2",
      changeView:
        "UPDATE sf_ops_dashboard.ops_view_snapshot SET view_code = 'EVENT_HEALTH' WHERE tenant_id = $1 AND snapshot_id = $2",
      changeTenant:
        'UPDATE sf_ops_dashboard.ops_view_snapshot SET tenant_id = $3 WHERE tenant_id = $1 AND snapshot_id = $2',
      flipFlag:
        'UPDATE sf_ops_dashboard.ops_view_snapshot SET non_authoritative = false WHERE tenant_id = $1 AND snapshot_id = $2',
      advance:
        "UPDATE sf_ops_dashboard.ops_view_snapshot SET status = 'DEGRADED', snapshot_version = 2 WHERE tenant_id = $1 AND snapshot_id = $2",
    } as const;
    const upd = (sql: (typeof UPDATES)[keyof typeof UPDATES]): Promise<unknown> =>
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(sql, sql.includes('$3') ? [T1, id, T2] : [T1, id]),
      );
    expect(await denied(() => upd(UPDATES.skipVersion))).toBe('P0001');
    expect(await denied(() => upd(UPDATES.sameVersion))).toBe('P0001');
    expect(await denied(() => upd(UPDATES.changeView))).not.toBe('allowed');
    expect(await denied(() => upd(UPDATES.changeTenant))).not.toBe('allowed');
    expect(await denied(() => upd(UPDATES.flipFlag))).not.toBe('allowed');
    expect(await denied(() => upd(UPDATES.advance))).toBe('allowed');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query('DELETE FROM sf_ops_dashboard.ops_view_snapshot WHERE tenant_id = $1', [T1]),
        ),
      ),
    ).toBe('42501');

    const refreshId = randomUUID();
    await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(
        `INSERT INTO sf_ops_dashboard.ops_view_refresh_log (tenant_id, refresh_id, view_code, outcome, resulting_status, attempted_at, actor_id, correlation_id)
         VALUES ($1,$2,'PLATFORM_HEALTH','SUCCESS','OK', now(), $3, $4)`,
        [T1, refreshId, OFFICER, randomUUID()],
      ),
    );
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `UPDATE sf_ops_dashboard.ops_view_refresh_log SET outcome = 'SOURCE_FAILED' WHERE tenant_id = $1`,
            [T1],
          ),
        ),
      ),
    ).not.toBe('allowed');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `INSERT INTO sf_ops_dashboard.ops_view_refresh_log (tenant_id, refresh_id, view_code, outcome, resulting_status, attempted_at, actor_id, correlation_id)
             VALUES ($1,$2,'PLATFORM_HEALTH','SOURCE_FAILED','UNAVAILABLE', now(), $3, $4)`,
            [T1, randomUUID(), OFFICER, randomUUID()],
          ),
        ),
      ),
    ).toBe('23514');
  });

  it('isolated reversibility: down of the CMP-046 pair removes the schema and keeps the role; up restores it', async () => {
    await withIsolatedDatabase(h.admin, async (iso, migrateIso) => {
      migrateIso('up');
      const names = async (): Promise<string[]> =>
        (
          await iso.query<{ name: string }>(
            'SELECT name FROM sf_platform.sf_schema_migrations ORDER BY name',
          )
        ).rows.map((r) => r.name);
      const expected = MIGRATION_FILES.map((f) => f.replace(/\.sql$/, ''));
      expect((await names()).slice(-2)).toEqual(expected);
      const schema = async (): Promise<number> =>
        (await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_ops_dashboard'`))
          .rowCount ?? 0;
      expect(await schema()).toBe(1);
      migrateIso('down', 2);
      expect(await schema()).toBe(0);
      const role = await iso.query(
        `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp046_rw'`,
      );
      expect(role.rows[0]?.['rolcanlogin']).toBe(false);
      migrateIso('up');
      expect(await schema()).toBe(1);
      const forced = await iso.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_ops_dashboard' AND c.relkind = 'r' AND c.relforcerowsecurity`,
      );
      expect(forced.rows[0]?.['n']).toBe(5);
    });
  }, 180_000);
});
