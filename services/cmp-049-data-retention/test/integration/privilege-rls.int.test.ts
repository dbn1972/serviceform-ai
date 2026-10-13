import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asTenant,
  closeHarness,
  MIGRATION_FILES,
  OFFICER,
  resetData,
  RUNTIME_ROLE,
  setupHarness,
  T1,
  T2,
  withIsolatedDatabase,
  type Harness,
  type PgClient,
} from './helpers.js';

const TRANSITIONS = JSON.stringify([
  { from_eligibility: 'ACTIVE', to_eligibility: 'ARCHIVE_ELIGIBLE' },
  { from_eligibility: 'ARCHIVE_ELIGIBLE', to_eligibility: 'DELETE_ELIGIBLE' },
  { from_eligibility: 'ACTIVE', to_eligibility: 'LEGAL_HOLD' },
  { from_eligibility: 'LEGAL_HOLD', to_eligibility: 'ACTIVE' },
]);

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

async function insertPolicy(
  c: PgClient,
  tenant: string,
  over: Partial<{ id: string; ref: string | null; version: number; flag: boolean }> = {},
): Promise<string> {
  const id = over.id ?? randomUUID();
  await c.query(
    `INSERT INTO sf_retention.retention_policy (
       tenant_id, policy_id, policy_version, resource_type, owner_supplied_period_ref,
       eligibility_transitions, statutory_retention_policy_input_required, created_at, updated_at,
       created_by, last_correlation_id
     ) VALUES ($1,$2,$3,'APPLICATION',$4,$5::jsonb,$6,now(),now(),$7,$8)`,
    [
      tenant,
      id,
      over.version ?? 1,
      over.ref ?? null,
      TRANSITIONS,
      over.flag ?? true,
      OFFICER,
      randomUUID(),
    ],
  );
  return id;
}

async function insertSubject(
  c: PgClient,
  tenant: string,
  policyId: string,
  over: Partial<{ eligibility: string; resourceType: string }> = {},
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO sf_retention.retention_subject (
       tenant_id, subject_id, policy_id, resource_type, resource_id, eligibility, subject_version,
       created_at, updated_at, last_correlation_id
     ) VALUES ($1,$2,$3,$4,$5,$6,1,now(),now(),$7)`,
    [
      tenant,
      id,
      policyId,
      over.resourceType ?? 'APPLICATION',
      randomUUID(),
      over.eligibility ?? 'ACTIVE',
      randomUUID(),
    ],
  );
  return id;
}

function moveSubject(c: PgClient, tenant: string, subjectId: string, to: string): Promise<unknown> {
  return c.query(
    `UPDATE sf_retention.retention_subject
        SET eligibility = $3, subject_version = subject_version + 1, updated_at = now()
      WHERE tenant_id = $1 AND subject_id = $2`,
    [tenant, subjectId, to],
  );
}

describe('CMP-049 privilege boundary (ADR-0006), FORCE RLS and fail-closed DB guards (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 180_000);

  beforeEach(async () => {
    await resetData(h.admin);
  });

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS, tables owned by sf_migrator with FORCE RLS', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [['sf_cmp049_rw', 'sf_migrator', RUNTIME_ROLE]],
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
        WHERE n.nspname = 'sf_retention' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.map((t) => t['relname'])).toEqual([
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
      'retention_policy',
      'retention_subject',
      'retention_transition_log',
    ]);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) {
        expect(t['rls'], String(t['relname'])).toBe(true);
        expect(t['forced'], String(t['relname'])).toBe(true);
      }
    }
  });

  it('sf_app holds no DML on retention state; a peer privilege role cannot read or write it', async () => {
    const appDml = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_retention' AND grantee = 'sf_app'
          AND table_name LIKE 'retention_%'`,
    );
    expect(appDml.rows).toEqual([]);
    expect(await denied(() => asTenant(h.peer, T1, OFFICER, (c) => insertPolicy(c, T1)))).not.toBe(
      'allowed',
    );
    expect(
      await denied(() =>
        asTenant(h.peer, T1, OFFICER, (c) =>
          c.query('SELECT 1 FROM sf_retention.retention_subject'),
        ),
      ),
    ).not.toBe('allowed');
    const crossGrants = await h.admin.query(
      `SELECT table_schema, table_name FROM information_schema.role_table_grants
        WHERE grantee = 'sf_cmp049_rw' AND table_schema <> 'sf_retention'`,
    );
    expect(crossGrants.rows).toEqual([]);
    const deleteGrants = await h.admin.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'sf_cmp049_rw' AND table_schema = 'sf_retention'
          AND privilege_type IN ('DELETE','TRUNCATE') AND table_name LIKE 'retention_%'`,
    );
    expect(deleteGrants.rows).toEqual([]);
  });

  it('FORCE RLS hides the other tenant; a session with no tenant sees nothing and cannot write', async () => {
    await asTenant(h.rt, T1, OFFICER, (c) => insertPolicy(c, T1));
    await asTenant(h.rt, T2, OFFICER, (c) => insertPolicy(c, T2));
    const t1 = await asTenant(h.rt, T1, OFFICER, async (c) =>
      (await c.query('SELECT tenant_id FROM sf_retention.retention_policy')).rows.map(
        (r) => r['tenant_id'],
      ),
    );
    expect(t1).toEqual([T1]);
    const none = await asTenant(
      h.rt,
      null,
      OFFICER,
      async (c) => (await c.query('SELECT 1 FROM sf_retention.retention_policy')).rows,
    );
    expect(none).toEqual([]);
    expect(await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertPolicy(c, T2)))).toBe(
      '42501',
    );
    expect(await denied(() => asTenant(h.rt, null, OFFICER, (c) => insertPolicy(c, T1)))).not.toBe(
      'allowed',
    );
  });

  it('a tenant cannot enrol a subject under another tenant policy (FK + RLS)', async () => {
    const p2 = await asTenant(h.rt, T2, OFFICER, (c) => insertPolicy(c, T2));
    expect(
      await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertSubject(c, T1, p2))),
    ).not.toBe('allowed');
  });

  it('database refuses invented periods and flipped markers on policies', async () => {
    for (const ref of ['30', '365d', 'P7Y', 'PT24H', '7years']) {
      expect(
        await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertPolicy(c, T1, { ref }))),
        ref,
      ).toBe('23514');
    }
    expect(
      await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertPolicy(c, T1, { flag: false }))),
    ).toBe('23514');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) => insertPolicy(c, T1, { ref: 'owner-input:ref-1' })),
      ),
    ).toBe('allowed');
  });

  it('DB fail-closed: ARCHIVE_ELIGIBLE / DELETE_ELIGIBLE refused while the policy period ref is null', async () => {
    const { subjectId, policyId } = await asTenant(h.rt, T1, OFFICER, async (c) => {
      const p = await insertPolicy(c, T1);
      return { policyId: p, subjectId: await insertSubject(c, T1, p) };
    });
    const archive = await asTenant(h.rt, T1, OFFICER, (c) =>
      c
        .query(
          `UPDATE sf_retention.retention_subject
              SET eligibility = 'ARCHIVE_ELIGIBLE', subject_version = 2, updated_at = now()
            WHERE tenant_id = $1 AND subject_id = $2`,
          [T1, subjectId],
        )
        .then(
          () => 'allowed',
          (e: { code?: string; hint?: string }) => `${e.code}:${e.hint}`,
        ),
    );
    expect(archive).toBe('P0001:SF_POLICY_INPUT_REQUIRED');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `INSERT INTO sf_retention.retention_transition_log (
               tenant_id, transition_id, subject_id, policy_id, policy_version, from_eligibility,
               to_eligibility, owner_supplied_period_ref, subject_version, actor_id, correlation_id,
               transitioned_at
             ) VALUES ($1,$2,$3,$4,1,'ACTIVE','ARCHIVE_ELIGIBLE',NULL,2,$5,$6,now())`,
            [T1, randomUUID(), subjectId, policyId, OFFICER, randomUUID()],
          ),
        ),
      ),
    ).toBe('23514');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) => moveSubject(c, T1, subjectId, 'LEGAL_HOLD')),
      ),
    ).toBe('allowed');
  });

  it('DB guards: policy listing enforced, period ref bound once, identity immutable, no deletes', async () => {
    const policyId = await asTenant(h.rt, T1, OFFICER, (c) => insertPolicy(c, T1));
    const subjectId = await asTenant(h.rt, T1, OFFICER, (c) => insertSubject(c, T1, policyId));
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) => moveSubject(c, T1, subjectId, 'DELETE_ELIGIBLE')),
      ),
    ).toBe('P0001');
    const bind = (ref: string | null, version: number): Promise<string> =>
      denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `UPDATE sf_retention.retention_policy
                SET owner_supplied_period_ref = $3, policy_version = $4, updated_at = now()
              WHERE tenant_id = $1 AND policy_id = $2`,
            [T1, policyId, ref, version],
          ),
        ),
      );
    expect(await bind('owner-input:ref-1', 3)).toBe('P0001');
    expect(await bind('owner-input:ref-1', 2)).toBe('allowed');
    expect(await bind('owner-input:ref-2', 3)).toBe('P0001');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `UPDATE sf_retention.retention_policy SET eligibility_transitions = '[]'::jsonb WHERE tenant_id = $1`,
            [T1],
          ),
        ),
      ),
    ).not.toBe('allowed');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) => moveSubject(c, T1, subjectId, 'ARCHIVE_ELIGIBLE')),
      ),
    ).toBe('allowed');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            'UPDATE sf_retention.retention_subject SET resource_id = $2 WHERE tenant_id = $1',
            [T1, randomUUID()],
          ),
        ),
      ),
    ).not.toBe('allowed');
    for (const sql of [
      'DELETE FROM sf_retention.retention_policy WHERE tenant_id = $1',
      'DELETE FROM sf_retention.retention_subject WHERE tenant_id = $1',
    ]) {
      expect(await denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, [T1]))), sql).toBe(
        '42501',
      );
    }
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          insertSubject(c, T1, policyId, { eligibility: 'LEGAL_HOLD' }),
        ),
      ),
    ).toBe('P0001');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          insertSubject(c, T1, policyId, { resourceType: 'DOCUMENT' }),
        ),
      ),
    ).toBe('23514');
  });

  it('isolated reversibility: down of the CMP-049 pair removes the schema and keeps the role; up restores it', async () => {
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
        (await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_retention'`)).rowCount ??
        0;
      expect(await schema()).toBe(1);
      migrateIso('down', 2);
      expect(await schema()).toBe(0);
      const role = await iso.query(
        `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp049_rw'`,
      );
      expect(role.rows[0]?.['rolcanlogin']).toBe(false);
      migrateIso('up');
      expect(await schema()).toBe(1);
      const forced = await iso.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_retention' AND c.relkind = 'r' AND c.relforcerowsecurity`,
      );
      expect(forced.rows[0]?.['n']).toBe(6);
    });
  }, 180_000);
});
