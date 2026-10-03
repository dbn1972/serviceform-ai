import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T1,
  U1,
  U2,
  asTenant,
  createLogins,
  dropLogins,
  expectPgError,
  migrate,
} from './helpers.js';
import type pg from 'pg';

describe('CMP-048 RLS and state machine (002-01..002-08)', () => {
  let rt: pg.Pool;
  let other: pg.Pool;

  beforeAll(async () => {
    migrate('up');
    const logins = await createLogins();
    rt = logins.rt;
    other = logins.other;
  });

  afterAll(async () => {
    if (rt && other) await dropLogins(rt, other);
  });

  it('002-01 H1 identity', async () => {
    const c = await rt.connect();
    try {
      const r = await c.query(
        `SELECT current_user = session_user AS same, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
      );
      expect(r.rows[0].same).toBe(true);
      expect(r.rows[0].rolsuper).toBe(false);
      expect(r.rows[0].rolbypassrls).toBe(false);
    } finally {
      c.release();
    }
  });

  it('002-06 insert APPROVED is refused; self-approval refused', async () => {
    await asTenant(rt, T1, U2, async (c) => {
      const bad = await expectPgError(c, () =>
        c.query(
          `INSERT INTO sf_security.privileged_access_record (
            id, tenant_id, grantee_user_id, grantee_actor_type, access_kind, purpose_code, justification,
            scope_actions, scope_resource_types, requested_by, approved_by, approved_at, status, starts_at, expires_at
          ) VALUES ($1,$2,$3,'OFFICER','BREAK_GLASS','SUPPORT','justification text',
            ARRAY['VIEW'], ARRAY['ExampleAggregate'], $4, $4, now(), 'APPROVED', now(), now() + interval '1 hour')`,
          [randomUUID(), T1, U1, U2],
        ),
      );
      expect(bad.message).toMatch(/REQUESTED/);
      const id = randomUUID();
      await c.query(
        `INSERT INTO sf_security.privileged_access_record (
          id, tenant_id, grantee_user_id, grantee_actor_type, access_kind, purpose_code, justification,
          scope_actions, scope_resource_types, requested_by, status, starts_at, expires_at
        ) VALUES ($1,$2,$3,'OFFICER','BREAK_GLASS','SUPPORT','justification text',
          ARRAY['VIEW'], ARRAY['ExampleAggregate'], $4, 'REQUESTED', now(), now() + interval '1 hour')`,
        [id, T1, U1, U2],
      );
      const self = await expectPgError(c, () =>
        c.query(
          `UPDATE sf_security.privileged_access_record
           SET status = 'APPROVED', approved_by = $2, approved_at = now() WHERE id = $1`,
          [id, U2],
        ),
      );
      expect(self.message).toMatch(/self-approval|approved_by/);
    });
  });

  it('002-07 window and immutability', async () => {
    await asTenant(rt, T1, U2, async (c) => {
      const window = await expectPgError(c, () =>
        c.query(
          `INSERT INTO sf_security.privileged_access_record (
            id, tenant_id, grantee_user_id, grantee_actor_type, access_kind, purpose_code, justification,
            scope_actions, scope_resource_types, requested_by, status, starts_at, expires_at
          ) VALUES ($1,$2,$3,'OFFICER','BREAK_GLASS','SUPPORT','justification text',
            ARRAY['VIEW'], ARRAY['ExampleAggregate'], $4, 'REQUESTED', now(), now() - interval '1 hour')`,
          [randomUUID(), T1, U1, U2],
        ),
      );
      expect(window.message.length).toBeGreaterThan(0);
      const id = randomUUID();
      await c.query(
        `INSERT INTO sf_security.privileged_access_record (
          id, tenant_id, grantee_user_id, grantee_actor_type, access_kind, purpose_code, justification,
          scope_actions, scope_resource_types, requested_by, status, starts_at, expires_at
        ) VALUES ($1,$2,$3,'OFFICER','BREAK_GLASS','SUPPORT','justification text',
          ARRAY['VIEW'], ARRAY['ExampleAggregate'], $4, 'REQUESTED', now(), now() + interval '1 hour')`,
        [id, T1, U1, U2],
      );
      const imm = await expectPgError(c, () =>
        c.query(
          `UPDATE sf_security.privileged_access_record SET grantee_user_id = $2 WHERE id = $1`,
          [id, U2],
        ),
      );
      expect(imm.message).toMatch(/immutable|permission denied/);
    });
  });

  it('002-08 policy activation maker-checker and one ACTIVE', async () => {
    await asTenant(rt, T1, U2, async (c) => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO sf_security.security_policy_metadata
          (id, bundle_name, revision, content_sha256, roots, status, published_by, test_report_sha256)
         VALUES ($1,'sf','r1',$2, ARRAY['sf','system/log'], 'VALIDATED', $3, $2)`,
        [id, 'a'.repeat(64), U2],
      );
      const maker = await expectPgError(c, () =>
        c.query(
          `UPDATE sf_security.security_policy_metadata SET status = 'ACTIVE', approved_by = $2, activated_at = now() WHERE id = $1`,
          [id, U2],
        ),
      );
      expect(maker.message).toMatch(/maker-checker/);
      await c.query(
        `UPDATE sf_security.security_policy_metadata SET status = 'ACTIVE', approved_by = $2, activated_at = now() WHERE id = $1`,
        [id, U1],
      );
      const id2 = randomUUID();
      await c.query(
        `INSERT INTO sf_security.security_policy_metadata
          (id, bundle_name, revision, content_sha256, roots, status, published_by, test_report_sha256)
         VALUES ($1,'sf','r2',$2, ARRAY['sf','system/log'], 'VALIDATED', $3, $2)`,
        [id2, 'b'.repeat(64), U2],
      );
      const second = await expectPgError(c, () =>
        c.query(
          `UPDATE sf_security.security_policy_metadata SET status = 'ACTIVE', approved_by = $2, activated_at = now() WHERE id = $1`,
          [id2, U1],
        ),
      );
      expect(second.message.length).toBeGreaterThan(0);
    });
  });

  it('002-04 FORCE RLS and no prosecdef', async () => {
    const c = await rt.connect();
    try {
      const rls = await c.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'sf_security' AND c.relname IN ('privileged_access_record','idempotency_record','outbox_event','inbox_event')`,
      );
      for (const row of rls.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }
      const defs = await c.query(
        `SELECT count(*)::int AS n FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'sf_security' AND p.prosecdef`,
      );
      expect(defs.rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });
});
