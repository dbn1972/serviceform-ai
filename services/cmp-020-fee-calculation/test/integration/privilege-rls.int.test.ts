import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  asTenant,
  CANARY_CODE,
  closeHarness,
  insertRawQuote,
  migrate,
  migrateDown,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

describe('CMP-020 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS; tables owned by sf_migrator with FORCE RLS', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('sf_cmp020_rw', 'sf_migrator', 'sf_t020_rt')`,
    );
    expect(roles.rows).toHaveLength(3);
    for (const r of roles.rows) {
      expect(r['rolsuper']).toBe(false);
      expect(r['rolbypassrls']).toBe(false);
      if (r['rolname'] !== 'sf_t020_rt') expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_fee' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.map((t) => t['relname'])).toEqual([
      'fee_quote',
      'fee_quote_line',
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
    ]);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) {
        expect(t['rls']).toBe(true);
        expect(t['forced']).toBe(true);
      }
    }
  });

  it('no non-owner role holds UPDATE/DELETE/TRUNCATE on quote tables', async () => {
    const grants = await h.admin.query(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_fee' AND table_name IN ('fee_quote','fee_quote_line')
          AND grantee <> 'sf_migrator'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')`,
    );
    expect(grants.rows).toEqual([]);
    const pub = await h.admin.query(
      `SELECT table_name FROM information_schema.role_table_grants WHERE table_schema = 'sf_fee' AND grantee = 'PUBLIC'`,
    );
    expect(pub.rows).toEqual([]);
  });

  it('a peer component login cannot read or write CMP-020 tables', async () => {
    const insert = await denied(() =>
      asTenant(h.other, T1, ACTOR, (c) => insertRawQuote(c, { tenant: T1 })),
    );
    expect(insert).toBe('42501');
    const read = await denied(() =>
      asTenant(h.other, T1, ACTOR, (c) => c.query('SELECT 1 FROM sf_fee.fee_quote')),
    );
    expect(read).toBe('42501');
  });

  it('wrong-tenant rows are invisible and cannot be written; no tenant context sees nothing', async () => {
    const canaryQuote = await asTenant(h.rt, T2, ACTOR, (c) =>
      insertRawQuote(c, { tenant: T2, code: CANARY_CODE }),
    );
    const t1Quote = await asTenant(h.rt, T1, ACTOR, (c) => insertRawQuote(c, { tenant: T1 }));

    const fromT1 = await asTenant(h.rt, T1, ACTOR, async (c) => ({
      quotes: (await c.query('SELECT quote_id, tenant_id FROM sf_fee.fee_quote')).rows,
      lines: (await c.query('SELECT code FROM sf_fee.fee_quote_line')).rows,
      direct: (await c.query('SELECT 1 FROM sf_fee.fee_quote WHERE quote_id = $1', [canaryQuote]))
        .rows,
    }));
    expect(fromT1.quotes.every((r) => r['tenant_id'] === T1)).toBe(true);
    expect(fromT1.quotes.map((r) => r['quote_id'])).toContain(t1Quote);
    expect(fromT1.direct).toEqual([]);
    expect(JSON.stringify(fromT1)).not.toContain(CANARY_CODE);

    const crossWrite = await denied(() =>
      asTenant(h.rt, T1, ACTOR, (c) => insertRawQuote(c, { tenant: T2 })),
    );
    expect(crossWrite).toBe('42501');

    const crossLine = await denied(() =>
      asTenant(h.rt, T1, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_fee.fee_quote_line (tenant_id, quote_id, line_seq, code, amount_minor, calculation_basis)
           VALUES ($1,$2,9,'INJECTED',1,'FEE_POLICY_LINE')`,
          [T2, canaryQuote],
        ),
      ),
    );
    expect(crossLine).toBe('42501');

    const noTenant = await asTenant(
      h.rt,
      null,
      ACTOR,
      async (c) =>
        (await c.query('SELECT count(*)::int AS n FROM sf_fee.fee_quote')).rows[0]?.['n'],
    );
    expect(noTenant).toBe(0);
  });

  it('issued quotes and lines are immutable even for the runtime role', async () => {
    const id = await asTenant(h.rt, T1, ACTOR, (c) => insertRawQuote(c, { tenant: T1 }));
    for (const sql of [
      'UPDATE sf_fee.fee_quote SET total_amount_minor = 1 WHERE quote_id = $1',
      'DELETE FROM sf_fee.fee_quote WHERE quote_id = $1',
      'UPDATE sf_fee.fee_quote_line SET amount_minor = 1 WHERE quote_id = $1',
      'DELETE FROM sf_fee.fee_quote_line WHERE quote_id = $1',
    ]) {
      expect(await denied(() => asTenant(h.rt, T1, ACTOR, (c) => c.query(sql, [id])))).toBe(
        '42501',
      );
    }
    const ownerCode = await denied(() =>
      h.admin.query('UPDATE sf_fee.fee_quote SET total_amount_minor = 1 WHERE quote_id = $1', [id]),
    );
    expect(ownerCode).toBe('42501');
  });

  it('commit-time integrity: total must equal the exact sum of lines and a quote needs a line', async () => {
    const mismatch = await denied(() =>
      asTenant(h.rt, T1, ACTOR, (c) =>
        insertRawQuote(c, { tenant: T1, total: '201', lineAmount: '100', lines: 2 }),
      ),
    );
    expect(mismatch).toBe('23514');
    const noLines = await denied(() =>
      asTenant(h.rt, T1, ACTOR, (c) => insertRawQuote(c, { tenant: T1, lines: 0 })),
    );
    expect(noLines).toBe('23514');
    const exactLarge = await asTenant(h.rt, T1, ACTOR, (c) =>
      insertRawQuote(c, {
        tenant: T1,
        total: '9007199254740990',
        lineAmount: '4503599627370495',
        lines: 2,
      }),
    );
    expect(exactLarge).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('column checks refuse client-authoritative amounts, negatives and unknown sources', async () => {
    const attempt = (currency: string, total: string, source: string, client: boolean) =>
      denied(() =>
        asTenant(h.rt, T1, ACTOR, (c) =>
          c.query(
            `INSERT INTO sf_fee.fee_quote (
               tenant_id, quote_id, application_id, cell_id, tenant_service_binding_id, fee_policy_version_id,
               fee_policy_content_hash, rule_version_id, currency, total_amount_minor, amount_source,
               client_authoritative_amount, facts_hash, calculation_hash, idempotency_key, correlation_id,
               actor_type, issued_by, issued_at
             ) VALUES ($1, gen_random_uuid(), gen_random_uuid(), 'cell-01', gen_random_uuid(), gen_random_uuid(),
               'sha256:' || repeat('a', 64), gen_random_uuid(), $3, $4::bigint, $5, $6,
               'sha256:' || repeat('f', 64), 'sha256:' || repeat('e', 64), 'raw-key-0002', gen_random_uuid(),
               'SYSTEM', $2, now())`,
            [T1, ACTOR, currency, total, source, client],
          ),
        ),
      );
    expect(await attempt('XTS', '1', 'FEE_POLICY_METADATA', true)).toBe('23514');
    expect(await attempt('XTS', '-1', 'FEE_POLICY_METADATA', false)).toBe('23514');
    expect(await attempt('XTS', '1', 'CLIENT', false)).toBe('23514');
    expect(await attempt('xts', '1', 'FEE_POLICY_METADATA', false)).toBe('23514');
  });

  it('down migration removes sf_fee and re-applies cleanly', async () => {
    migrateDown(2);
    const gone = await h.admin.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_fee'`);
    expect(gone.rows).toEqual([]);
    migrate();
    const back = await h.admin.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_fee'`);
    expect(back.rows).toHaveLength(1);
    const role = await h.admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp020_rw'`);
    expect(role.rows).toHaveLength(1);
    // Re-grant check: runtime login still works after re-apply.
    const id = randomUUID();
    await asTenant(h.rt, T1, ACTOR, (c) => insertRawQuote(c, { tenant: T1, quoteId: id }));
    const seen = await asTenant(
      h.rt,
      T1,
      ACTOR,
      async (c) => (await c.query('SELECT 1 FROM sf_fee.fee_quote WHERE quote_id = $1', [id])).rows,
    );
    expect(seen).toHaveLength(1);
  });
});
