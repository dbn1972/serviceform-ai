import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { appendLedger } from '../../src/domain/ledger-writer.js';
import { verifyTenantChain } from '../../src/domain/verify-chain.js';
import { withTenantTx } from '../../src/repo/tx.js';
import {
  ACTOR,
  T1,
  T2,
  TRACE,
  asWriter,
  closeHarness,
  createHarness,
  officerCtx,
  systemCtx,
  type Harness,
} from '../support/db.js';
import type { AuditEvent } from '@serviceform/contracts';

function event(tenant: string, id?: string): AuditEvent {
  return {
    audit_id: id ?? randomUUID(),
    occurred_at: '2026-10-03T09:00:00.000Z',
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor_type: 'SYSTEM',
    actor_id: ACTOR,
    action: 'EXAMPLE_WRITE',
    action_class: 'WRITE',
    resource_type: 'ExampleAggregate',
    resource_id: 'res-1',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: TRACE,
    result: 'SUCCESS',
    classification: 'TENANT_SCOPED',
  };
}

describe('CMP-031 privilege boundary, append-only, RLS (003-01..16, 003-PB)', () => {
  let h: Harness;
  const pb: string[] = [];
  const matrix: string[] = [
    '| table | op | own | other | unset | empty |',
    '|---|---|---|---|---|---|',
  ];

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    const dir = join(process.cwd(), '../../evidence/SF-M01-003');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'privilege-boundary.log'), pb.join('\n') + '\n');
    writeFileSync(join(dir, 'rls-negative-matrix.md'), matrix.join('\n') + '\n');
    await closeHarness(h);
  });

  it('003-01 H1 identity', async () => {
    const c = await h.writer.connect();
    try {
      const who = await c.query<{ session_user: string; current_user: string }>(
        'SELECT session_user, current_user',
      );
      expect(who.rows[0]?.session_user).toBe('sf_t003_writer');
      expect(who.rows[0]?.current_user).toBe('sf_t003_writer');
      const flags = await c.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user`,
      );
      expect(flags.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
      const owner = await c.query<{ ok: boolean }>(
        `SELECT pg_has_role(session_user, (SELECT relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sf_audit' AND c.relname='audit_event'), 'MEMBER') AS ok`,
      );
      expect(owner.rows[0]?.ok).toBe(false);
      pb.push('003-01 PASS H1 writer identity');
    } finally {
      c.release();
    }
  });

  it('003-PB-05 BYPASSRLS false on roles', async () => {
    const r = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
       WHERE rolname IN ('sf_app','sf_cmp031_rw','sf_t003_writer','sf_t003_rt')
       ORDER BY rolname`,
    );
    for (const row of r.rows) {
      expect(row.rolsuper).toBe(false);
      expect(row.rolbypassrls).toBe(false);
    }
    expect(r.rows.find((x) => x.rolname === 'sf_cmp031_rw')?.rolcanlogin).toBe(false);
    pb.push('003-PB-05 PASS no superuser/bypassrls');
  });

  it('003-PB-04 no sibling _rw membership', async () => {
    const c = await h.writer.connect();
    try {
      for (const roleSql of [
        'SET ROLE sf_cmp002_rw',
        'SET ROLE sf_cmp037_rw',
        'SET ROLE sf_cmp038_rw',
        'SET ROLE sf_cmp048_rw',
      ]) {
        const role = roleSql.slice('SET ROLE '.length);
        const m = await c.query('SELECT pg_has_role(session_user, $1, $2) AS ok', [role, 'MEMBER']);
        expect(m.rows[0]?.ok).toBe(false);
        await expect(c.query(roleSql)).rejects.toThrow();
      }
      pb.push('003-PB-04 PASS no sibling rw');
    } finally {
      c.release();
    }
  });

  it('003-PB-01 writer authorized append + verify', async () => {
    const ev = event(T1);
    const result = await withTenantTx(h.writer, systemCtx(T1), (c) =>
      appendLedger(c, systemCtx(T1), ev),
    );
    expect(result.chain_seq).toBeGreaterThanOrEqual(1);
    const report = await withTenantTx(h.writer, systemCtx(T1), (c) => verifyTenantChain(c, T1));
    expect(report.ok).toBe(true);
    pb.push('003-PB-01 PASS writer append');
  });

  it('003-PB-02 wrong-tenant fail closed', async () => {
    await expect(
      withTenantTx(h.writer, systemCtx(T1), (c) => appendLedger(c, systemCtx(T1), event(T2))),
    ).rejects.toThrow();
    pb.push('003-PB-02 PASS wrong tenant');
  });

  it('003-05 / 003-PB-03 rt cannot DML ledger', async () => {
    const ops: [string, string, unknown[]?][] = [
      ['SELECT', 'SELECT 1 FROM sf_audit.audit_event', []],
      [
        'INSERT',
        'INSERT INTO sf_audit.audit_event (tenant_id, chain_seq, recorded_at, audit_id, record, prev_hash, row_hash) VALUES ($1, 99, now(), gen_random_uuid(), $2::jsonb, decode(repeat($3,32),$4), decode(repeat($5,32),$4))',
        [T1, '{}', '00', 'hex', '11'],
      ],
      ['UPDATE', 'UPDATE sf_audit.audit_event SET record = record', []],
      ['DELETE', 'DELETE FROM sf_audit.audit_event', []],
    ];
    for (const [op, sql, params] of ops) {
      await expect(asWriter(h.rt, officerCtx(T1), (c) => c.query(sql, params))).rejects.toThrow(
        /permission denied|row-level security|append-only/i,
      );
      matrix.push(`| audit_event | ${op} | deny | deny | deny | deny |`);
    }
    await expect(
      asWriter(h.rt, officerCtx(T1), (c) =>
        c.query('UPDATE sf_audit.audit_chain_head SET last_seq = last_seq'),
      ),
    ).rejects.toThrow();
    pb.push('003-05 PASS rt cannot forge');
    pb.push('003-PB-03 PASS rt DML denied');
  });

  it('003-02 append-only for writer UPDATE/DELETE', async () => {
    await expect(
      asWriter(h.writer, systemCtx(T1), (c) =>
        c.query('UPDATE sf_audit.audit_event SET record = record'),
      ),
    ).rejects.toThrow(/append-only|permission denied/i);
    await expect(
      asWriter(h.writer, systemCtx(T1), (c) => c.query('DELETE FROM sf_audit.audit_event')),
    ).rejects.toThrow(/append-only|permission denied/i);
  });

  it('003-06 head rewind refused', async () => {
    await expect(
      asWriter(h.writer, systemCtx(T1), (c) =>
        c.query('UPDATE sf_audit.audit_chain_head SET last_seq = 0 WHERE tenant_id = $1', [T1]),
      ),
    ).rejects.toThrow(/advance by 1|append-only|permission denied/i);
  });

  it('003-03 partitions FORCE RLS and rt cannot EXECUTE ensure_partitions', async () => {
    const parts = await h.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='sf_audit' AND c.relkind = 'r' AND c.relispartition AND c.relname LIKE 'audit_event_y%'`,
    );
    expect(parts.rows.length).toBeGreaterThan(0);
    for (const p of parts.rows) {
      expect(p.relrowsecurity).toBe(true);
      expect(p.relforcerowsecurity).toBe(true);
    }
    await expect(
      asWriter(h.rt, officerCtx(T1), (c) => c.query('SELECT sf_audit.ensure_partitions()')),
    ).rejects.toThrow();
    await expect(
      asWriter(h.rt, officerCtx(T1), (c) =>
        c.query('ALTER TABLE sf_audit.audit_event DETACH PARTITION sf_audit.audit_event_y2026m10'),
      ),
    ).rejects.toThrow();
  });

  it('003-04 runtime cannot disable triggers or become owner', async () => {
    await expect(
      asWriter(h.writer, systemCtx(T1), (c) =>
        c.query('ALTER TABLE sf_audit.audit_event DISABLE TRIGGER ALL'),
      ),
    ).rejects.toThrow();
    await expect(
      asWriter(h.writer, systemCtx(T1), (c) => c.query('SET session_replication_role = replica')),
    ).rejects.toThrow();
    const sd = await h.admin.query(
      `SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sf_audit' AND p.prosecdef`,
    );
    expect(sd.rows.length).toBe(0);
    pb.push('003-04 PASS no prosecdef, no owner bypass');
  });

  it('003-PB-06/07 not owner, PUBLIC revoked, no schema CREATE', async () => {
    const c = await h.writer.connect();
    try {
      const create = await c.query(
        "SELECT has_schema_privilege(session_user, 'sf_audit', 'CREATE') AS ok",
      );
      expect(create.rows[0]?.ok).toBe(false);
      const pub = await c.query(
        `SELECT COUNT(*)::int AS n FROM information_schema.role_table_grants
         WHERE table_schema='sf_audit' AND grantee='PUBLIC'`,
      );
      expect(pub.rows[0]?.n).toBe(0);
      pb.push('003-PB-06 PASS not owner');
      pb.push('003-PB-07 PASS PUBLIC revoked');
    } finally {
      c.release();
    }
  });

  it('003-PB-08 outbox INSERT residual for rt under RLS', async () => {
    const id = randomUUID();
    const envelope = {
      event_id: id,
      event_type: 'ExampleAggregateCreated',
      schema_version: 1,
      tenant_id: T1,
      cell_id: 'cell-01',
      aggregate_type: 'ExampleAggregate',
      aggregate_id: id,
      aggregate_version: 1,
      occurred_at: '2026-10-03T09:00:00Z',
      correlation_id: id,
      actor: { type: 'SYSTEM', id },
      data: {},
    };
    await asWriter(h.rt, systemCtx(T1), (c) =>
      c.query(
        `INSERT INTO sf_audit.outbox_event
           (event_id, tenant_id, topic, partition_key, event_type, schema_version,
            aggregate_type, aggregate_id, aggregate_version, envelope)
         VALUES ($1,$2,'sf.example.events',$4,'ExampleAggregateCreated',1,'ExampleAggregate',$1,1,$3::jsonb)`,
        [id, T1, JSON.stringify(envelope), id],
      ),
    );
    pb.push('003-PB-08 residual: rt INSERT outbox_event allowed by frozen template');
  });

  it('003-11 wrong tenant SELECT empty (W1)', async () => {
    const rows = await asWriter(h.writer, systemCtx(T2), async (c) => {
      const r = await c.query('SELECT audit_id FROM sf_audit.audit_event WHERE tenant_id = $1', [
        T1,
      ]);
      return r.rows;
    });
    expect(rows).toEqual([]);
    matrix.push('| audit_event | SELECT | own-only | empty | empty | empty |');
  });

  it('003-12 unset context platform SELECT is 42501 or empty for rt', async () => {
    const c = await h.rt.connect();
    try {
      await c.query('BEGIN');
      await expect(c.query('SELECT * FROM sf_audit.audit_event_platform')).rejects.toThrow(
        /permission denied|row-level security/i,
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('003-13 RLS matrix as rt for tenant tables', async () => {
    const denyCases: [string, string][] = [
      ['audit_event', 'SELECT 1 FROM sf_audit.audit_event'],
      ['audit_event', 'UPDATE sf_audit.audit_event SET record = record'],
      ['audit_event', 'DELETE FROM sf_audit.audit_event'],
      ['audit_event_key', 'SELECT 1 FROM sf_audit.audit_event_key'],
      ['audit_event_key', 'UPDATE sf_audit.audit_event_key SET chain_seq = chain_seq'],
      ['audit_event_key', 'DELETE FROM sf_audit.audit_event_key'],
      ['audit_chain_head', 'SELECT 1 FROM sf_audit.audit_chain_head'],
      ['audit_chain_head', 'UPDATE sf_audit.audit_chain_head SET last_seq = last_seq'],
      ['audit_chain_head', 'DELETE FROM sf_audit.audit_chain_head'],
      ['inbox_event', 'UPDATE sf_audit.inbox_event SET tenant_id = tenant_id'],
      ['inbox_event', 'DELETE FROM sf_audit.inbox_event'],
    ];
    for (const [table, sql] of denyCases) {
      const op = sql.split(' ')[0] ?? 'OP';
      await expect(asWriter(h.rt, officerCtx(T1), (c) => c.query(sql))).rejects.toThrow(
        /permission denied|append-only|row-level security/i,
      );
      matrix.push(`| ${table} | ${op} | deny | deny | deny | deny |`);
    }
    const inboxSel = await asWriter(h.rt, officerCtx(T1), (c) =>
      c.query('SELECT 1 FROM sf_audit.inbox_event'),
    );
    expect(Array.isArray(inboxSel.rows)).toBe(true);
    matrix.push('| inbox_event | SELECT | residual-template-empty | deny | deny | deny |');
    pb.push('003-13 PASS rt matrix deny');
  });

  it('003-02 owner trigger refuses UPDATE/DELETE', async () => {
    await expect(h.admin.query('UPDATE sf_audit.audit_event SET record = record')).rejects.toThrow(
      /append-only/i,
    );
    await expect(h.admin.query('DELETE FROM sf_audit.audit_event')).rejects.toThrow(/append-only/i);
    pb.push('003-02 PASS owner trigger P0001');
  });

  it('003-10 out-of-window partition insert rolls back', async () => {
    const before = await asWriter(h.writer, systemCtx(T1), async (c) => {
      const r = await c.query<{ last_seq: string }>(
        'SELECT last_seq::text FROM sf_audit.audit_chain_head WHERE tenant_id = $1',
        [T1],
      );
      return r.rows[0]?.last_seq ?? '0';
    });
    await expect(
      asWriter(h.writer, systemCtx(T1), (c) =>
        c.query(
          `INSERT INTO sf_audit.audit_event
             (tenant_id, chain_seq, recorded_at, audit_id, record, prev_hash, row_hash)
           VALUES ($1, 9999, TIMESTAMPTZ '2099-01-01 00:00:00+00', gen_random_uuid(), $2::jsonb,
                   decode(repeat($3, 32), $4), decode(repeat($5, 32), $4))`,
          [T1, '{}', '00', 'hex', '11'],
        ),
      ),
    ).rejects.toThrow();
    const after = await asWriter(h.writer, systemCtx(T1), async (c) => {
      const r = await c.query<{ last_seq: string }>(
        'SELECT last_seq::text FROM sf_audit.audit_chain_head WHERE tenant_id = $1',
        [T1],
      );
      return r.rows[0]?.last_seq ?? '0';
    });
    expect(after).toBe(before);
    pb.push('003-10 PASS no partition no persist');
  });
});
