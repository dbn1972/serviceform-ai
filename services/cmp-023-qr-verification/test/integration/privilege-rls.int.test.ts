import { randomBytes, randomUUID } from 'node:crypto';
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

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

const opaque = (): string => randomBytes(32).toString('base64url');

async function insertToken(
  c: PgClient,
  tenant: string,
  over: Partial<{
    credentialId: string;
    opaque: string;
    purpose: string;
    readOnly: boolean;
    piiForbidden: boolean;
    statusSource: string;
    actorType: string;
    expiresAt: string | null;
  }> = {},
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO sf_qr.verification_token (
       tenant_id, token_id, credential_id, opaque_token, token_purpose, credential_type_ref,
       issuer_ref, issued_at, signed_artifact_sha256, status_source_cmp, registry_status_read_only,
       embedded_pii_forbidden, expires_at, actor_type, actor_id, created_at, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,'credtype:tenant-meta:0001','issuer:tenant-meta:0001',now(),
               repeat('b',64),$6,$7,$8,$9,$10,$11,now(),$12)`,
    [
      tenant,
      id,
      over.credentialId ?? randomUUID(),
      over.opaque ?? opaque(),
      over.purpose ?? 'PUBLIC_CREDENTIAL_VERIFICATION',
      over.statusSource ?? 'CMP-024',
      over.readOnly ?? true,
      over.piiForbidden ?? true,
      over.expiresAt ?? null,
      over.actorType ?? 'OFFICER',
      OFFICER,
      randomUUID(),
    ],
  );
  return id;
}

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});
beforeEach(async () => {
  await resetData(h.admin);
});

describe('privilege posture (ADR-0006)', () => {
  it('sf_cmp023_rw is NOLOGIN, NOSUPERUSER, NOBYPASSRLS; sf_migrator owns every table; FORCE RLS on tenant tables', async () => {
    const role = await h.admin.query<Record<string, boolean>>(
      `SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp023_rw'`,
    );
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
    const tables = await h.admin.query<{
      relname: string;
      owner: string;
      rls: boolean;
      force: boolean;
    }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls,
              c.relforcerowsecurity AS force
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_qr' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.map((t) => t.relname)).toEqual([
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
      'verification_token',
    ]);
    for (const t of tables.rows) {
      expect(t.owner, t.relname).toBe('sf_migrator');
      if (!t.relname.endsWith('_platform')) expect(t.force && t.rls, t.relname).toBe(true);
    }
  });

  it('runtime may only SELECT/INSERT tokens: no UPDATE or DELETE grant, and rows are insert-only', async () => {
    const grants = await h.admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'sf_cmp023_rw' AND table_schema = 'sf_qr' AND table_name = 'verification_token'
        ORDER BY 1`,
    );
    expect(grants.rows.map((g) => g.privilege_type)).toEqual(['INSERT', 'SELECT']);
    const id = await asTenant(h.rt, T1, OFFICER, (c) => insertToken(c, T1));
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(
            `UPDATE sf_qr.verification_token SET credential_type_ref = 'x' WHERE token_id = $1`,
            [id],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          c.query(`DELETE FROM sf_qr.verification_token WHERE token_id = $1`, [id]),
        ),
      ),
    ).toBe('42501');
    expect(
      await denied(() =>
        h.admin.query(`UPDATE sf_qr.verification_token SET issuer_ref = 'x' WHERE token_id = $1`, [
          id,
        ]),
      ),
    ).toBe('42501');
  });

  it('the token table has no column that could hold, cache or override a registry status', async () => {
    const cols = await h.admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'sf_qr' AND table_name = 'verification_token' AND column_name LIKE '%status%'
        ORDER BY 1`,
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      'registry_status_read_only',
      'status_source_cmp',
      'status_write_forbidden',
    ]);
  });

  it('a peer component role cannot read sf_qr', async () => {
    expect(
      await denied(() =>
        asTenant(h.peer, T1, OFFICER, (c) => c.query('SELECT 1 FROM sf_qr.verification_token')),
      ),
    ).toBe('42501');
  });
});

describe('FORCE RLS tenant isolation', () => {
  it('tenant B and a tenant-less session see none of tenant A tokens', async () => {
    const token = opaque();
    await asTenant(h.rt, T1, OFFICER, (c) => insertToken(c, T1, { opaque: token }));
    const own = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query('SELECT token_id FROM sf_qr.verification_token WHERE opaque_token = $1', [token]),
    );
    expect(own.rows).toHaveLength(1);
    const other = await asTenant(h.rt, T2, OFFICER, (c) =>
      c.query('SELECT token_id FROM sf_qr.verification_token WHERE opaque_token = $1', [token]),
    );
    expect(other.rows).toHaveLength(0);
    const none = await asTenant(h.rt, null, OFFICER, (c) =>
      c.query('SELECT token_id FROM sf_qr.verification_token'),
    );
    expect(none.rows).toHaveLength(0);
  });

  it('a session cannot write another tenant row or a tenant-less row', async () => {
    expect(await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertToken(c, T2)))).toBe(
      '42501',
    );
    expect(await denied(() => asTenant(h.rt, null, OFFICER, (c) => insertToken(c, T1)))).toBe(
      '42501',
    );
  });
});

describe('database guards', () => {
  it('constant markers and token format are enforced by CHECK constraints', async () => {
    const check = (over: Parameters<typeof insertToken>[2]) =>
      denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertToken(c, T1, over)));
    expect(await check({ readOnly: false })).toBe('23514');
    expect(await check({ piiForbidden: false })).toBe('23514');
    expect(await check({ statusSource: 'CMP-023' })).toBe('23514');
    expect(await check({ purpose: 'HOLDER_LOOKUP' })).toBe('23514');
    expect(await check({ opaque: 'short' })).toBe('23514');
    expect(await check({ opaque: `${'a'.repeat(30)}/=` })).toBe('23514');
    expect(await check({ actorType: 'CITIZEN' })).toBe('23514');
    expect(await check({ expiresAt: '2000-01-01T00:00:00Z' })).toBe('23514');
  });

  it('one token per credential and unique opaque tokens per tenant', async () => {
    const cred = randomUUID();
    const token = opaque();
    await asTenant(h.rt, T1, OFFICER, (c) =>
      insertToken(c, T1, { credentialId: cred, opaque: token }),
    );
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) => insertToken(c, T1, { credentialId: cred })),
      ),
    ).toBe('23505');
    expect(
      await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertToken(c, T1, { opaque: token }))),
    ).toBe('23505');
    await asTenant(h.rt, T2, OFFICER, (c) => insertToken(c, T2, { credentialId: cred }));
  });
});

describe('migration reversibility', () => {
  it('the CMP-023 pair goes down and up cleanly on an isolated database', async () => {
    expect(RUNTIME_ROLE).toBe('sf_t023_rt');
    await withIsolatedDatabase(h.admin, async (iso, migrateIso) => {
      migrateIso('up');
      const has = async (): Promise<boolean> =>
        (
          await iso.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'sf_qr'`,
          )
        ).rows[0]?.n === 1;
      expect(await has()).toBe(true);
      migrateIso('down', MIGRATION_FILES.length);
      expect(await has()).toBe(false);
      migrateIso('up');
      expect(await has()).toBe(true);
    });
  });
});
