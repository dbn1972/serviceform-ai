import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  asTenant,
  CANARY_BINDING,
  closeHarness,
  insertRawIntent,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';
import { requireDefined } from '../doubles/fixtures.js';

/**
 * Privilege and RLS integration tests for CMP-021 Payment Service.
 *
 * Verifies ADR-0006 Option A requirements:
 * - sf_cmp021_rw NOLOGIN, NOBYPASSRLS, FORCE RLS
 * - Runtime login role (sf_t021_rt = sf_app + sf_cmp021_rw) can only see own-tenant rows
 * - Peer login role (sf_t021_other = sf_app + sf_cmp048_rw) has no column privilege on sf_payment
 * - Column grants are narrowly scoped (only UPDATE status allowed on payment_intent)
 * - Canary binding row belonging to T2 is invisible to T1 session
 * - Direct INSERT without tenant session variable rejected by RLS policy
 */
describe.skipIf(!process.env['DATABASE_URL'])('privilege and rls (integration)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  // ── ADR-0006 role attributes ──────────────────────────────────────────────

  it('sf_cmp021_rw is NOLOGIN and NOBYPASSRLS', async () => {
    const r = await h.admin.query(
      `SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp021_rw'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.['rolcanlogin']).toBe(false);
    expect(r.rows[0]?.['rolbypassrls']).toBe(false);
  });

  it('sf_payment tables have FORCE ROW LEVEL SECURITY enabled', async () => {
    const r = await h.admin.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'sf_payment'
          AND c.relkind = 'r'
          AND c.relname IN ('payment_intent','payment_callback','exactly_once_effect','idempotency_record')
        ORDER BY c.relname`,
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(4);
    for (const row of r.rows) {
      expect(row['relrowsecurity'], `${String(row['relname'])} must have RLS enabled`).toBe(true);
      expect(row['relforcerowsecurity'], `${String(row['relname'])} must have FORCE RLS`).toBe(
        true,
      );
    }
  });

  it('sf_payment tables are owned by sf_migrator (not a login role)', async () => {
    const r = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'sf_payment' AND c.relkind = 'r'
        ORDER BY c.relname`,
    );
    for (const row of r.rows) {
      expect(row['owner'], `${String(row['relname'])} must be owned by sf_migrator`).toBe(
        'sf_migrator',
      );
    }
  });

  // ── Column grant: UPDATE on payment_intent limited to status column ───────

  it('sf_cmp021_rw has UPDATE privilege only on status column of payment_intent', async () => {
    const r = await h.admin.query(
      `SELECT column_name, privilege_type
         FROM information_schema.column_privileges
        WHERE table_schema = 'sf_payment'
          AND table_name = 'payment_intent'
          AND grantee = 'sf_cmp021_rw'
          AND privilege_type = 'UPDATE'`,
    );
    const updatableCols = r.rows.map((row) => row['column_name']);
    expect(updatableCols).toContain('status');
    const r2 = await h.admin.query(
      `SELECT column_name
         FROM information_schema.column_privileges
        WHERE table_schema = 'sf_payment'
          AND table_name = 'payment_intent'
          AND grantee = 'sf_cmp021_rw'
          AND privilege_type = 'UPDATE'
          AND column_name <> 'status'`,
    );
    expect(r2.rows).toHaveLength(0);
  });

  // ── Tenant isolation via FORCE RLS ────────────────────────────────────────

  it('tenant A cannot read tenant B intent rows (FORCE RLS isolation)', async () => {
    // Admin inserts an intent belonging to T2 (canary row)
    const canaryId = await asTenant(h.admin, T2, ACTOR, (c) => insertRawIntent(c, { tenant: T2 }));

    // sf_t021_rt session for T1 should NOT see the T2 canary row
    let foundByT1: unknown[] = [];
    await asTenant(h.rt, T1, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT payment_intent_id FROM sf_payment.payment_intent WHERE payment_intent_id = $1`,
        [canaryId],
      );
      foundByT1 = r.rows;
    });
    expect(foundByT1).toHaveLength(0);
  });

  it('canary binding (T2 intent) never visible in T1 session SELECT *', async () => {
    // Insert T2 intent with known CANARY_BINDING connector_binding_id
    const canaryIntentId = await asTenant(h.admin, T2, ACTOR, (c) =>
      insertRawIntent(c, { tenant: T2 }),
    );

    let leakedRows: unknown[] = [];
    await asTenant(h.rt, T1, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT payment_intent_id, connector_binding_id FROM sf_payment.payment_intent`,
      );
      leakedRows = r.rows.filter(
        (row) =>
          (row as Record<string, unknown>)['payment_intent_id'] === canaryIntentId ||
          (row as Record<string, unknown>)['connector_binding_id'] === CANARY_BINDING,
      );
    });
    expect(leakedRows).toHaveLength(0);
  });

  it('tenant A can INSERT and SELECT own intent; peer tenant B cannot see it', async () => {
    let intentId: string;

    // T1 inserts its own intent
    await asTenant(h.rt, T1, ACTOR, async (c) => {
      intentId = await insertRawIntent(c, { tenant: T1 });
    });

    // T1 can read own intent
    await asTenant(h.rt, T1, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT payment_intent_id FROM sf_payment.payment_intent WHERE payment_intent_id = $1`,
        [requireDefined(intentId, 'intentId')],
      );
      expect(r.rows).toHaveLength(1);
    });

    // T2 session cannot see T1 intent
    await asTenant(h.rt, T2, ACTOR, async (c) => {
      const r = await c.query(
        `SELECT payment_intent_id FROM sf_payment.payment_intent WHERE payment_intent_id = $1`,
        [requireDefined(intentId, 'intentId')],
      );
      expect(r.rows).toHaveLength(0);
    });
  });

  // ── Peer role cannot access sf_payment tables ─────────────────────────────

  it('peer role (sf_t021_other = sf_app + sf_cmp048_rw) is denied SELECT on payment_intent', async () => {
    await expect(
      asTenant(h.other, T1, ACTOR, async (c) => {
        await c.query(`SELECT 1 FROM sf_payment.payment_intent LIMIT 1`);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('peer role cannot INSERT into payment_intent', async () => {
    await expect(
      asTenant(h.other, T1, ACTOR, async (c) => {
        await insertRawIntent(c, { tenant: T1 });
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  // ── RLS without tenant_id session var ─────────────────────────────────────

  it('INSERT without app.tenant_id session variable is blocked by RLS policy', async () => {
    // Run under rt pool but do NOT set app.tenant_id → current_tenant_id() returns NULL
    // RLS policy: tenant_id = sf_platform.current_tenant_id() → NULL = NULL is false → denied
    const client = await h.rt.connect();
    try {
      await client.query('BEGIN');
      // Set actor but NOT tenant_id
      await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', ACTOR]);
      await client.query('SELECT set_config($1, $2, true)', [
        'app.correlation_id',
        '00000000-0000-4000-8000-000000000001',
      ]);
      await expect(insertRawIntent(client, { tenant: T1 })).rejects.toBeDefined();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  // ── Down-migration: schema dropped ───────────────────────────────────────
  // This test intentionally skipped by default; run manually with ALLOW_DESTRUCTIVE=1
  it.skipIf(!process.env['ALLOW_DESTRUCTIVE'])(
    'down-migration removes sf_payment schema',
    async () => {
      const { migrateDown } = await import('./helpers.js');
      migrateDown(2);
      const r = await h.admin.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'sf_payment'`,
      );
      expect(r.rows).toHaveLength(0);
    },
  );
});
