import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRegistryApi } from '../../src/api/handler.js';
import { buildCredentialRegistryService } from '../../src/index.js';
import { PgRegistryRepository } from '../../src/repo/pg.js';
import type { RegistryTx } from '../../src/repo/types.js';
import type { RequestContext } from '../../src/types.js';
import { ScriptedAuthorizer } from '../doubles/fixtures.js';
import {
  asSqlPool,
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

const S = 'sf_credential_registry';
const SYSTEM = 'b1111111-1111-4111-8111-111111111111';

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

async function insertEntry(c: PgClient, tenant: string, id = randomUUID()): Promise<string> {
  await c.query(
    `INSERT INTO sf_credential_registry.credential_registry_entry (tenant_id, credential_id, issuer_ref, current_status,
       status_version, registered_at, updated_at, registered_by, last_correlation_id)
     VALUES ($1,$2,'issuer:meta:1','REGISTERED',1,now(),now(),$3,$4)`,
    [tenant, id, SYSTEM, randomUUID()],
  );
  await c.query(
    `INSERT INTO sf_credential_registry.credential_status_history (tenant_id, entry_id, credential_id, sequence,
       from_status, to_status, actor_type, actor_id, correlation_id, changed_at)
     VALUES ($1,$2,$3,1,NULL,'REGISTERED','SYSTEM',$4,$5,now())`,
    [tenant, randomUUID(), id, SYSTEM, randomUUID()],
  );
  return id;
}

function ctx(
  tenant: string,
  actorId: string,
  type: RequestContext['actor']['type'],
): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type, id: actorId },
    roles: ['CREDENTIAL_REGISTRY'],
    jurisdiction_ids: [],
    auth_assurance: type === 'SYSTEM' ? 'WORKLOAD_IDENTITY' : 'MFA',
    correlation_id: randomUUID(),
    trace_id: '0123456789abcdef0123456789abcdef',
  };
}

let h: Harness | undefined;
const H = (): Harness => h as Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});
beforeEach(async () => {
  await resetData(H().admin);
});

describe('CMP-024 on PostgreSQL through the runtime login role', () => {
  it('API flow persists status, append-only history and outbox rows', async () => {
    const state: { ctx: RequestContext } = { ctx: ctx(T1, SYSTEM, 'SYSTEM') };
    const service = buildCredentialRegistryService({
      pool: asSqlPool(H().rt),
      authorizer: new ScriptedAuthorizer(),
    });
    const api = createRegistryApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
    const id = randomUUID();
    let n = 0;
    const post = (path: string, body: object) =>
      api.handle({
        method: 'POST',
        path,
        headers: { 'idempotency-key': `int-key-${++n}-0000` },
        body,
      });
    const base = `/v1/credential-registry/credentials`;
    expect((await post(base, { credential_id: id, issuer_ref: 'issuer:meta:1' })).status).toBe(201);
    expect((await post(`${base}/${id}/activate`, { expected_version: 1 })).status).toBe(200);
    state.ctx = ctx(T1, OFFICER, 'OFFICER');
    expect(
      (await post(`${base}/${id}/suspend`, { expected_version: 2, reason_code_ref: 'r:1' })).status,
    ).toBe(200);
    const revoke = await post(`${base}/${id}/revoke`, {
      expected_version: 3,
      reason_code_ref: 'r:2',
    });
    expect(revoke.status).toBe(200);
    const read = await api.handle({ method: 'GET', path: `${base}/${id}/status`, headers: {} });
    expect(read.status).toBe(200);
    const doc = (read.body as { credential_status: { current_status: string; history: unknown[] } })
      .credential_status;
    expect(doc.current_status).toBe('REVOKED');
    expect(doc.history).toHaveLength(4);
    const rows = await H().admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sf_credential_registry.outbox_event WHERE tenant_id = $1`,
      [T1],
    );
    expect(Number(rows.rows[0]?.n)).toBe(8);
  });

  it('RLS: another tenant sees no rows and cannot write rows for the first tenant', async () => {
    const id = await asTenant(H().rt, T1, SYSTEM, (c) => insertEntry(c, T1));
    const seen = await asTenant(H().rt, T2, OFFICER, async (c) => {
      const e = await c.query(
        `SELECT 1 FROM sf_credential_registry.credential_registry_entry WHERE credential_id = $1`,
        [id],
      );
      const hist = await c.query(
        `SELECT 1 FROM sf_credential_registry.credential_status_history WHERE credential_id = $1`,
        [id],
      );
      return e.rows.length + hist.rows.length;
    });
    expect(seen).toBe(0);
    expect(await code(() => asTenant(H().rt, T2, OFFICER, (c) => insertEntry(c, T1)))).toBe(
      '42501',
    );
    const upd = await asTenant(H().rt, T2, OFFICER, (c) =>
      c.query(
        `UPDATE sf_credential_registry.credential_registry_entry SET current_status = 'REVOKED', status_version = 2
          WHERE credential_id = $1`,
        [id],
      ),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('no tenant context means no rows', async () => {
    await asTenant(H().rt, T1, SYSTEM, (c) => insertEntry(c, T1));
    const n = await asTenant(
      H().rt,
      null,
      OFFICER,
      async (c) =>
        (await c.query(`SELECT 1 FROM sf_credential_registry.credential_registry_entry`)).rows
          .length,
    );
    expect(n).toBe(0);
  });

  it('history is immutable and entries are never deleted', async () => {
    const id = await asTenant(H().rt, T1, SYSTEM, (c) => insertEntry(c, T1));
    expect(
      await code(() =>
        asTenant(H().rt, T1, OFFICER, (c) =>
          c.query(
            `UPDATE sf_credential_registry.credential_status_history SET reason_code_ref = 'x' WHERE credential_id = $1`,
            [id],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await code(() =>
        asTenant(H().rt, T1, OFFICER, (c) =>
          c.query(
            `DELETE FROM sf_credential_registry.credential_status_history WHERE credential_id = $1`,
            [id],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await code(() =>
        asTenant(H().rt, T1, OFFICER, (c) =>
          c.query(
            `DELETE FROM sf_credential_registry.credential_registry_entry WHERE credential_id = $1`,
            [id],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await code(() =>
        H().admin.query(
          `UPDATE sf_credential_registry.credential_status_history SET reason_code_ref = 'x' WHERE credential_id = $1`,
          [id],
        ),
      ),
    ).toBe('42501');
  });

  it('database guards refuse illegal and terminal transitions and mismatched history', async () => {
    const id = await asTenant(H().rt, T1, SYSTEM, (c) => insertEntry(c, T1));
    const setStatus = (status: string, version: number, successor: string | null = null) =>
      asTenant(H().rt, T1, OFFICER, (c) =>
        c.query(
          `UPDATE sf_credential_registry.credential_registry_entry
              SET current_status = $2, status_version = $3, superseded_by_credential_id = $4
            WHERE credential_id = $1`,
          [id, status, version, successor],
        ),
      );
    expect(await code(() => setStatus('SUSPENDED', 2))).toBe('P0001');
    expect(await code(() => setStatus('ACTIVE', 3))).toBe('P0001');
    expect(await code(() => setStatus('REISSUED', 2))).toBe('P0001');
    expect(await code(() => setStatus('REVOKED', 2))).toBe('allowed');
    expect(await code(() => setStatus('ACTIVE', 3))).toBe('P0001');
    expect(
      await code(() =>
        asTenant(H().rt, T1, OFFICER, (c) =>
          c.query(
            `INSERT INTO sf_credential_registry.credential_status_history (tenant_id, entry_id, credential_id, sequence,
               from_status, to_status, reason_code_ref, actor_type, actor_id, correlation_id, changed_at)
             VALUES ($1,$2,$3,2,'REGISTERED','ACTIVE',NULL,'OFFICER',$4,$5,now())`,
            [T1, randomUUID(), id, OFFICER, randomUUID()],
          ),
        ),
      ),
    ).toBe('P0001');
    expect(
      await code(() =>
        asTenant(H().rt, T1, OFFICER, (c) =>
          c.query(
            `INSERT INTO sf_credential_registry.credential_status_history (tenant_id, entry_id, credential_id, sequence,
               from_status, to_status, reason_code_ref, actor_type, actor_id, correlation_id, changed_at)
             VALUES ($1,$2,$3,2,'REGISTERED','REVOKED',NULL,'OFFICER',$4,$5,now())`,
            [T1, randomUUID(), id, OFFICER, randomUUID()],
          ),
        ),
      ),
    ).toBe('23514');
    expect(
      await code(() =>
        asTenant(H().rt, T1, OFFICER, (c) =>
          c.query(
            `UPDATE sf_credential_registry.credential_registry_entry SET issuer_ref = 'other' WHERE credential_id = $1`,
            [id],
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('a peer component role has no access to the registry schema', async () => {
    expect(
      await code(() =>
        asTenant(H().peer, T1, OFFICER, (c) =>
          c.query(`SELECT 1 FROM sf_credential_registry.credential_registry_entry`),
        ),
      ),
    ).toBe('42501');
  });

  it('the read transaction is READ ONLY at the database', async () => {
    const id = await asTenant(H().rt, T1, SYSTEM, (c) => insertEntry(c, T1));
    const repo = new PgRegistryRepository(asSqlPool(H().rt));
    const attempt = await code(() =>
      repo.withReadTx(ctx(T1, OFFICER, 'OFFICER'), async (tx) => {
        const smuggled = tx as unknown as Partial<RegistryTx>;
        expect(smuggled.updateEntryStatus).toBeUndefined();
        const client = (tx as unknown as { c: PgClient }).c;
        await client.query(
          `UPDATE sf_credential_registry.credential_registry_entry SET current_status = 'ACTIVE', status_version = 2
            WHERE credential_id = $1`,
          [id],
        );
      }),
    );
    expect(attempt).toBe('25006');
    const status = await H().admin.query<{ s: string }>(
      `SELECT current_status AS s FROM sf_credential_registry.credential_registry_entry WHERE credential_id = $1`,
      [id],
    );
    expect(status.rows[0]?.s).toBe('REGISTERED');
  });

  it('runtime login is not the owner and holds no BYPASSRLS', async () => {
    const r = await H().admin.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1',
      [RUNTIME_ROLE],
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const owners = await H().admin.query<{ tableowner: string; force: boolean }>(
      `SELECT t.tableowner, c.relforcerowsecurity AS force FROM pg_tables t
         JOIN pg_class c ON c.relname = t.tablename
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
        WHERE t.schemaname = $1 AND t.tablename IN
          ('credential_registry_entry','credential_status_history','idempotency_record','outbox_event','inbox_event')`,
      [S],
    );
    expect(owners.rows).toHaveLength(5);
    for (const row of owners.rows) expect(row).toEqual({ tableowner: 'sf_migrator', force: true });
  });
});

describe('CMP-024 migration reversibility', () => {
  it('up -> down 2 -> up on an isolated database', async () => {
    await withIsolatedDatabase(H().admin, async (iso, migrate) => {
      migrate('up');
      const has = async () =>
        (await iso.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [S])).rows.length;
      expect(await has()).toBe(1);
      migrate('down', MIGRATION_FILES.length);
      expect(await has()).toBe(0);
      migrate('up');
      expect(await has()).toBe(1);
    });
  });
});
