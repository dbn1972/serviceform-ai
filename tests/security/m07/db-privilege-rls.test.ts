import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Live PostgreSQL probes against the full migrated chain. Requires M07SEC_DATABASE_URL (an admin
 * URL to a disposable database already migrated `up`). Skips, and is reported as skipped, when absent.
 */
const URL_ENV = process.env['M07SEC_DATABASE_URL'];
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const requireFromDb = createRequire(join(ROOT, 'db/package.json'));

interface Q {
  query<R = Record<string, unknown>>(
    t: string,
    p?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}
interface Client extends Q {
  connect(): Promise<void>;
  end(): Promise<void>;
}

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '99999999-9999-4999-8999-999999999999';
const ACTOR = '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42';
const M07_SCHEMAS = ['sf_credential', 'sf_credential_registry', 'sf_qr', 'sf_digilocker'];
const ROLES = {
  r022: 'sf_cmp022_rw',
  r023: 'sf_cmp023_rw',
  r024: 'sf_cmp024_rw',
  r012: 'sf_cmp012_rw',
} as const;
type Key = keyof typeof ROLES;
const login = (k: Key) => `sf_m07sec_${k}`;

let admin: Client;
const clients: Partial<Record<Key, Client>> = {};
const password = randomBytes(18).toString('hex');

async function sqlstate(c: Q, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await c.query(sql, params);
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
}

async function asTenant<T>(c: Q, tenant: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    if (tenant) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    await c.query(`SELECT set_config('app.actor_id', $1, true)`, [ACTOR]);
    return await fn();
  } finally {
    await c.query('ROLLBACK');
  }
}

/** Role DDL cannot take bind parameters; quote identifiers/literals server-side via format(). */
async function ddl(template: string, args: string[]): Promise<void> {
  const stmt = await admin.query<{ s: string }>(
    'SELECT format($1::text, VARIADIC $2::text[]) AS s',
    [template, args],
  );
  await admin.query(stmt.rows[0]?.s ?? 'SELECT 1');
}

/** One statement in its own rolled-back transaction under the given tenant. */
function probe(c: Q, tenant: string | null, sql: string, params: unknown[] = []): Promise<string> {
  return asTenant(c, tenant, () => sqlstate(c, sql, params));
}

describe.skipIf(!URL_ENV)('SF-M07-SEC live DB: privilege boundaries and RLS (PostgreSQL)', () => {
  beforeAll(async () => {
    const pg = requireFromDb('pg') as { Client: new (cfg: object) => Client };
    admin = new pg.Client({ connectionString: URL_ENV });
    await admin.connect();
    const parsed = new URL(URL_ENV as string);
    for (const k of Object.keys(ROLES) as Key[]) {
      await ddl('DROP ROLE IF EXISTS %I', [login(k)]);
      await ddl(
        'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, %I',
        [login(k), password, ROLES[k]],
      );
      const c = new pg.Client({
        host: parsed.hostname,
        port: Number(parsed.port || 5432),
        database: parsed.pathname.slice(1),
        user: login(k),
        password,
      });
      await c.connect();
      clients[k] = c;
    }
  });

  afterAll(async () => {
    for (const c of Object.values(clients)) await c?.end();
    for (const k of Object.keys(ROLES) as Key[]) {
      await ddl('DROP OWNED BY %I', [login(k)]).catch(() => undefined);
      await ddl('DROP ROLE IF EXISTS %I', [login(k)]).catch(() => undefined);
    }
    await admin?.end();
  });

  it('all M07 tenant tables ENABLE + FORCE RLS; only *_platform tables are exempt', async () => {
    const { rows } = await admin.query<{ t: string; rls: boolean; force: boolean }>(
      `SELECT n.nspname || '.' || c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = ANY($1)`,
      [M07_SCHEMAS],
    );
    expect(rows.length).toBeGreaterThanOrEqual(20);
    const unprotected = rows.filter((r) => !(r.rls && r.force)).map((r) => r.t);
    expect(
      unprotected.every((t) => t.endsWith('_platform')),
      unprotected.join(','),
    ).toBe(true);
  });

  it('M07 runtime roles are NOSUPERUSER NOBYPASSRLS and own no M07 schema', async () => {
    const { rows } = await admin.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY($1)`, [
      [...Object.values(ROLES), 'sf_app'],
    ]);
    expect(rows).toHaveLength(5);
    for (const r of rows)
      expect([r.rolname, r.rolsuper, r.rolbypassrls]).toEqual([r.rolname, false, false]);
    const owners = await admin.query<{ o: string }>(
      `SELECT pg_get_userbyid(nspowner) AS o FROM pg_namespace WHERE nspname = ANY($1)`,
      [M07_SCHEMAS],
    );
    for (const o of owners.rows) expect(Object.values(ROLES)).not.toContain(o.o);
  });

  it('only CMP-024 can write registry status; CMP-023/022/012 roles get 42501', async () => {
    const credential = randomUUID();
    for (const k of ['r023', 'r022', 'r012'] as const) {
      const c = clients[k] as Client;
      const codes = [
        await probe(
          c,
          T1,
          `UPDATE sf_credential_registry.credential_registry_entry SET current_status = 'REVOKED' WHERE credential_id = $1`,
          [credential],
        ),
        await probe(
          c,
          T1,
          `SELECT 1 FROM sf_credential_registry.credential_registry_entry LIMIT 1`,
        ),
        await probe(
          c,
          T1,
          `INSERT INTO sf_credential_registry.credential_status_history (tenant_id) VALUES ($1)`,
          [T1],
        ),
        await probe(c, T1, `DELETE FROM sf_credential_registry.credential_registry_entry`),
      ];
      expect(codes, k).toEqual(['42501', '42501', '42501', '42501']);
    }
  });

  it('no M07 role can reach another M07 component schema (no cross-component SQL)', async () => {
    const own: Record<Key, string> = {
      r022: 'sf_credential',
      r023: 'sf_qr',
      r024: 'sf_credential_registry',
      r012: 'sf_digilocker',
    };
    const probeTable: Record<string, string> = {
      sf_credential: 'sf_credential.credential',
      sf_qr: 'sf_qr.verification_token',
      sf_credential_registry: 'sf_credential_registry.credential_registry_entry',
      sf_digilocker: 'sf_digilocker.publish_record',
    };
    for (const k of Object.keys(own) as Key[]) {
      const c = clients[k] as Client;
      for (const schema of M07_SCHEMAS.filter((s) => s !== own[k])) {
        const code = await asTenant(c, T1, () =>
          sqlstate(c, `SELECT 1 FROM ${probeTable[schema]} LIMIT 1`),
        );
        expect(code, `${k} -> ${schema}`).toBe('42501');
      }
    }
  });

  it('registry RLS: tenant B sees and updates nothing of tenant A; WITH CHECK blocks foreign tenant_id', async () => {
    const c = clients.r024 as Client;
    const cred = randomUUID();
    await c.query('BEGIN');
    try {
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);
      await c.query(
        `INSERT INTO sf_credential_registry.credential_registry_entry
           (tenant_id, credential_id, issuer_ref, current_status, status_version, registered_at, updated_at, registered_by, last_correlation_id)
         VALUES ($1, $2, 'issuer:sec:1', 'REGISTERED', 1, now(), now(), $3, $4)`,
        [T1, cred, ACTOR, randomUUID()],
      );
      const own = await c.query(
        `SELECT 1 FROM sf_credential_registry.credential_registry_entry WHERE credential_id = $1`,
        [cred],
      );
      expect(own.rowCount).toBe(1);

      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [T2]);
      const seen = await c.query(
        `SELECT 1 FROM sf_credential_registry.credential_registry_entry WHERE credential_id = $1`,
        [cred],
      );
      expect(seen.rowCount).toBe(0);
      const upd = await c.query(
        `UPDATE sf_credential_registry.credential_registry_entry SET current_status = 'REVOKED', status_version = 2 WHERE credential_id = $1`,
        [cred],
      );
      expect(upd.rowCount).toBe(0);

      await c.query('SAVEPOINT s1');
      const foreign = await sqlstate(
        c,
        `INSERT INTO sf_credential_registry.credential_registry_entry
           (tenant_id, credential_id, issuer_ref, current_status, status_version, registered_at, updated_at, registered_by, last_correlation_id)
         VALUES ($1, $2, 'issuer:sec:1', 'REGISTERED', 1, now(), now(), $3, $4)`,
        [T1, randomUUID(), ACTOR, randomUUID()],
      );
      expect(foreign).toBe('42501');
      await c.query('ROLLBACK TO SAVEPOINT s1');

      await c.query(`SELECT set_config('app.tenant_id', '', true)`);
      const none = await c.query(`SELECT 1 FROM sf_credential_registry.credential_registry_entry`);
      expect(none.rowCount).toBe(0);
    } finally {
      await c.query('ROLLBACK');
    }
  });

  it('QR token RLS: an opaque token stored for tenant A is invisible to tenant B lookups', async () => {
    const c = clients.r023 as Client;
    const opaque = randomBytes(32).toString('base64url');
    await c.query('BEGIN');
    try {
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);
      await c.query(
        `INSERT INTO sf_qr.verification_token
           (tenant_id, token_id, credential_id, opaque_token, credential_type_ref, issuer_ref, actor_type, actor_id, created_at, correlation_id)
         VALUES ($1, $2, $3, $4, 'credtype:sec:1', 'issuer:sec:1', 'SYSTEM', $5, now(), $6)`,
        [T1, randomUUID(), randomUUID(), opaque, ACTOR, randomUUID()],
      );
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [T2]);
      const r = await c.query(`SELECT 1 FROM sf_qr.verification_token WHERE opaque_token = $1`, [
        opaque,
      ]);
      expect(r.rowCount).toBe(0);
      const del = await sqlstate(
        c,
        `DELETE FROM sf_qr.verification_token WHERE opaque_token = $1`,
        [opaque],
      );
      expect(del).toBe('42501');
    } finally {
      await c.query('ROLLBACK');
    }
  });

  it('DigiLocker publish records cannot be updated into another tenant or deleted', async () => {
    const c = clients.r012 as Client;
    const codes = [
      await probe(c, T1, `DELETE FROM sf_digilocker.publish_record`),
      await probe(c, T1, `UPDATE sf_digilocker.publish_record SET tenant_id = $1`, [T2]),
      await probe(c, T1, `UPDATE sf_digilocker.publish_record SET consent_ref = $1`, [
        randomUUID(),
      ]),
    ];
    expect(codes).toEqual(['42501', '42501', '42501']);
  });
});
