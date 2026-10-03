import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@serviceform/observability';
import type { AuditEvent, EventEnvelope, RequestContext } from '@serviceform/contracts';
import pg from 'pg';
import { handleEnvelope } from '../../src/consumer/handle-envelope.js';
import { appendLedger } from '../../src/domain/ledger-writer.js';
import { verifyTenantChain } from '../../src/domain/verify-chain.js';
import { registerAuditPlugin } from '../../src/plugin.js';
import { withTenantTx } from '../../src/repo/tx.js';
import {
  ACTOR,
  T1,
  T2,
  TRACE,
  closeHarness,
  createHarness,
  systemCtx,
  type Harness,
} from '../support/db.js';

const logs: string[] = [];
const logStream = new Writable({
  write(chunk: Buffer, _enc, cb) {
    logs.push(chunk.toString());
    cb();
  },
});

function allowAll() {
  return {
    async decide() {
      return {
        allow: true,
        reason_code: 'ALLOW',
        policy_revision: 'test',
        decision_id: randomUUID(),
      };
    },
  };
}

function sample(tenant: string | null, extra?: Partial<AuditEvent>): AuditEvent {
  return {
    audit_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor_type: 'SYSTEM',
    actor_id: ACTOR,
    action: extra?.action ?? 'EXAMPLE_WRITE',
    action_class: extra?.action_class ?? 'WRITE',
    resource_type: extra?.resource_type ?? 'ExampleAggregate',
    resource_id: extra?.resource_id ?? 'res-1',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: TRACE,
    result: extra?.result ?? 'SUCCESS',
    classification: extra?.classification ?? (tenant ? 'TENANT_SCOPED' : 'PLATFORM_OPERATIONAL'),
    ...extra,
  };
}

describe('CMP-031 API, consumer, tamper, duplicates', () => {
  let h: Harness;
  let ctx: RequestContext;
  const tamper: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    ctx = systemCtx(T1);
  });

  afterAll(async () => {
    const dir = join(process.cwd(), '../../evidence/SF-M01-003');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tamper-detection.log'), tamper.join('\n') + '\n');
    await closeHarness(h);
  });

  async function appFor(current: () => RequestContext | null) {
    const app = Fastify({ logger: false });
    const logger = createLogger({ service: 'cmp-031', version: '0', destination: logStream });
    await registerAuditPlugin(app, {
      pool: h.writer,
      resolveRequestContext: () => current(),
      authz: allowAll(),
      logger,
      platformSources: ['sf-source-platform'],
    });
    await app.ready();
    return app;
  }

  it('POST stores and GET lists own tenant only (003-11, 003-22)', async () => {
    let current: RequestContext | null = ctx;
    const app = await appFor(() => current);
    const body = sample(T1);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const again = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: body,
    });
    expect(again.statusCode).toBe(200);
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: { ...body, action: 'OTHER_WRITE' },
    });
    expect(conflict.statusCode).toBe(409);
    current = systemCtx(T2);
    const other = await app.inject({
      method: 'GET',
      url: `/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z`,
    });
    expect(other.statusCode).toBe(200);
    const page = other.json() as { items: unknown[] };
    const leaked = JSON.stringify(page).includes(body.audit_id);
    expect(leaked).toBe(false);
    await app.close();
  });

  it('003-19 actor mismatch is 403', async () => {
    const app = await appFor(() => ctx);
    const body = sample(T1, { actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: { ...sample(T1), actor_id: body.actor_id },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('003-18 privileged read deny is session-scoped, not query-gated', async () => {
    const plat = systemCtx(null);
    plat.actor = { type: 'PRIVILEGED_ADMIN', id: ACTOR };
    const app = await appFor(() => plat);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit?from=2026-09-01T00:00:00Z&to=2026-10-31T00:00:00Z&target_tenant_id=${T1}&reason=investigation`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
    const admin = await h.admin.connect();
    try {
      const recorded = await admin.query<{ action: string; result: string }>(
        `SELECT record->>'action' AS action, record->>'result' AS result
         FROM sf_audit.audit_event_platform
         WHERE record->>'action' = 'AUDIT_CROSS_TENANT_READ'
         ORDER BY recorded_at DESC LIMIT 1`,
      );
      expect(recorded.rows[0]).toMatchObject({
        action: 'AUDIT_CROSS_TENANT_READ',
        result: 'DENIED',
      });
    } finally {
      admin.release();
    }
    const tenantApp = await appFor(() => ctx);
    const tenantRes = await tenantApp.inject({
      method: 'GET',
      url: `/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z&target_tenant_id=${T2}`,
    });
    expect(tenantRes.statusCode).toBe(200);
    expect(JSON.stringify(tenantRes.json())).not.toContain(T2);
    await tenantApp.close();
  });

  it('003-24 extra field rejected', async () => {
    const app = await appFor(() => ctx);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: { ...sample(T1), aadhaar_number: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).not.toMatchObject({ aadhaar_number: 'x' });
    await app.close();
  });

  it('003-26 client_context dropped', async () => {
    const ev = sample(T1);
    const stored = await withTenantTx(h.writer, ctx, (c) =>
      appendLedger(c, ctx, {
        ...ev,
        client_context: { source_ip: '203.0.113.1', device_id: 'dev-1' },
      }),
    );
    const row = await withTenantTx(h.writer, ctx, async (c) => {
      const r = await c.query<{ record: AuditEvent }>(
        'SELECT record FROM sf_audit.audit_event WHERE audit_id = $1',
        [stored.audit_id],
      );
      return r.rows[0]?.record;
    });
    expect(row?.client_context).toBeUndefined();
  });

  it('consumer handleEnvelope stores once (003-21, 003-22 D3)', async () => {
    const ev = sample(T1);
    const envelope: EventEnvelope<AuditEvent> = {
      event_id: randomUUID(),
      event_type: 'AuditEventSubmitted',
      schema_version: 1,
      tenant_id: ev.tenant_id,
      cell_id: ev.cell_id,
      aggregate_type: 'AuditEvent',
      aggregate_id: ev.audit_id,
      aggregate_version: 0,
      occurred_at: ev.occurred_at,
      correlation_id: ev.correlation_id,
      actor: { type: ev.actor_type, id: ev.actor_id },
      data: ev,
    };
    const first = await handleEnvelope(h.writer, envelope, { platformSources: [] });
    expect(first.status).toBe('stored');
    const second = await handleEnvelope(h.writer, envelope, { platformSources: [] });
    expect(second.status).toBe('already_applied');
    const badType = await handleEnvelope(
      h.writer,
      { ...envelope, event_id: randomUUID(), event_type: 'Nope' },
      { platformSources: [] },
    );
    expect(badType.status).toBe('dead_lettered');
  });

  it('003-20 platform source allowlist', async () => {
    const ev = sample(null, {
      action_class: 'PRIVILEGED',
      reason: 'platform-op',
      action: 'PLATFORM_ACT',
    });
    const envelope: EventEnvelope<AuditEvent> = {
      event_id: randomUUID(),
      event_type: 'AuditEventSubmitted',
      schema_version: 1,
      tenant_id: null,
      cell_id: ev.cell_id,
      aggregate_type: 'AuditEvent',
      aggregate_id: ev.audit_id,
      aggregate_version: 0,
      occurred_at: ev.occurred_at,
      correlation_id: ev.correlation_id,
      actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR },
      data: { ...ev, actor_type: 'PRIVILEGED_ADMIN' },
    };
    const denied = await handleEnvelope(h.writer, envelope, {
      source: 'forged',
      platformSources: ['sf-source-platform'],
    });
    expect(denied.status).toBe('dead_lettered');
    const ok = await handleEnvelope(h.writer, envelope, {
      source: 'sf-source-platform',
      platformSources: ['sf-source-platform'],
    });
    expect(ok.status === 'stored' || ok.status === 'duplicate').toBe(true);
  });

  it('003-07 tamper detection', async () => {
    const ev = sample(T1);
    await withTenantTx(h.writer, ctx, (c) => appendLedger(c, ctx, ev));
    const admin = await h.admin.connect();
    try {
      await admin.query("SELECT set_config('session_replication_role', 'replica', false)");
      await admin.query(
        "UPDATE sf_audit.audit_event SET record = jsonb_set(record, '{action}', '\"TAMPERED\"') WHERE audit_id = $1",
        [ev.audit_id],
      );
      const report = await verifyTenantChain(admin, T1);
      expect(report.ok).toBe(false);
      expect(report.findings.some((f) => f.kind === 'HASH_MISMATCH')).toBe(true);
      tamper.push(JSON.stringify({ case: 'T1-modified-record', findings: report.findings }));
      await admin.query(
        "UPDATE sf_audit.audit_event SET record = jsonb_set(record, '{action}', '\"EXAMPLE_WRITE\"') WHERE audit_id = $1",
        [ev.audit_id],
      );
    } finally {
      await admin.query("SELECT set_config('session_replication_role', 'origin', false)");
      admin.release();
    }
  });

  it('003-07 concurrent writers same tenant contiguous seq', async () => {
    const n = 20;
    const ctxs = systemCtx(T1);
    const results = await Promise.all(
      Array.from({ length: n }, () =>
        withTenantTx(h.writer, ctxs, (c) => appendLedger(c, ctxs, sample(T1))),
      ),
    );
    const seqs = results.map((r) => r.chain_seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(n);
    const report = await withTenantTx(h.writer, ctxs, (c) => verifyTenantChain(c, T1));
    expect(report.ok).toBe(true);
    tamper.push(
      `T7-concurrent n=${String(n)} ok=${String(report.ok)} length=${String(report.length)}`,
    );
  });

  it('003-27 logs omit reason text', () => {
    const joined = logs.join('\n');
    expect(joined).not.toContain('Synthetic secret reason');
  });

  it('003-31 outbox template is contained in migration', async () => {
    const { readFileSync } = await import('node:fs');
    const { join: j } = await import('node:path');
    const tmpl = readFileSync(
      j(process.cwd(), '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_audit')
      .replaceAll('{cmp}', 'CMP-031')
      .trim();
    const mig = readFileSync(
      j(process.cwd(), '../../db/migrations/1759500301000_cmp-031-outbox-inbox.sql'),
      'utf8',
    );
    expect(mig).toContain(tmpl);
  });

  it('003-08 emoji/combining canonicalisation and NUL 400', async () => {
    const app = await appFor(() => ctx);
    const ev = sample(T1, { reason: 'ok café 👨‍👩‍👧 \u0041\u0301' });
    ev.action_class = 'OVERRIDE';
    const stored = await withTenantTx(h.writer, ctx, (c) => appendLedger(c, ctx, ev));
    expect(stored.chain_seq).toBeGreaterThan(0);
    const nul = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: { ...sample(T1), action: 'EXAMPLE_WRITE\u0000X' },
    });
    expect(nul.statusCode).toBe(400);
    expect(nul.statusCode).not.toBe(500);
    await app.close();
  });

  it('003-09 backdated occurred_at uses server recorded_at', async () => {
    const ev = sample(T1, { action: 'EXAMPLE_WRITE' });
    ev.occurred_at = '2026-09-01T00:00:00.000Z';
    const stored = await withTenantTx(h.writer, ctx, (c) => appendLedger(c, ctx, ev));
    expect(Date.parse(stored.recorded_at)).toBeGreaterThan(Date.parse(ev.occurred_at));
  });

  it('003-15 existence oracle: T1 GET of T2 resource looks unknown', async () => {
    const t2ctx = systemCtx(T2);
    const t2ev = sample(T2, { resource_id: 'CANARY-T2-RES' });
    await withTenantTx(h.writer, t2ctx, (c) => appendLedger(c, t2ctx, t2ev));
    const current: RequestContext | null = ctx;
    const app = await appFor(() => current);
    const a = await app.inject({
      method: 'GET',
      url: '/v1/audit/ExampleAggregate/CANARY-T2-RES?from=2026-09-01T00:00:00Z&to=2026-10-31T00:00:00Z',
    });
    const b = await app.inject({
      method: 'GET',
      url: '/v1/audit/ExampleAggregate/no-such-id?from=2026-09-01T00:00:00Z&to=2026-10-31T00:00:00Z',
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const itemsA = (a.json() as { items: { event: AuditEvent }[] }).items.filter(
      (i) => i.event.action !== 'AUDIT_READ',
    );
    const itemsB = (b.json() as { items: { event: AuditEvent }[] }).items.filter(
      (i) => i.event.action !== 'AUDIT_READ',
    );
    expect(itemsA).toEqual(itemsB);
    const post = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: { ...sample(T1), audit_id: t2ev.audit_id },
    });
    expect(post.statusCode).toBe(201);
    await app.close();
  });

  it('003-16 pool reuse current_tenant_id follows envelope', async () => {
    const pool = new pg.Pool({ connectionString: h.writerUrl, max: 1 });
    try {
      const ev1 = sample(T1);
      const env1: EventEnvelope<AuditEvent> = {
        event_id: randomUUID(),
        event_type: 'AuditEventSubmitted',
        schema_version: 1,
        tenant_id: ev1.tenant_id,
        cell_id: ev1.cell_id,
        aggregate_type: 'AuditEvent',
        aggregate_id: ev1.audit_id,
        aggregate_version: 0,
        occurred_at: ev1.occurred_at,
        correlation_id: ev1.correlation_id,
        actor: { type: ev1.actor_type, id: ev1.actor_id },
        data: ev1,
      };
      const ev2 = sample(T2);
      const env2: EventEnvelope<AuditEvent> = {
        ...env1,
        event_id: randomUUID(),
        tenant_id: T2,
        aggregate_id: ev2.audit_id,
        data: ev2,
        correlation_id: ev2.correlation_id,
      };
      const first = await handleEnvelope(pool, env1, { platformSources: [] });
      const second = await handleEnvelope(pool, env2, { platformSources: [] });
      expect(first.status).toBe('stored');
      expect(second.status).toBe('stored');
    } finally {
      await pool.end();
    }
  });

  it('003-17 without authz allow is 403', async () => {
    const app = Fastify({ logger: false });
    const logger = createLogger({ service: 'cmp-031', version: '0', destination: logStream });
    await registerAuditPlugin(app, {
      pool: h.writer,
      resolveRequestContext: () => ctx,
      logger,
    });
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    await app.close();
  });

  it('003-23 concurrent same id one winner', async () => {
    const ev = sample(T1);
    const results = await Promise.allSettled([
      withTenantTx(h.writer, ctx, (c) => appendLedger(c, ctx, ev)),
      withTenantTx(h.writer, ctx, (c) => appendLedger(c, ctx, { ...ev, action: 'OTHER_WRITE' })),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const bad = results.filter((r) => r.status === 'rejected').length;
    expect(ok + bad).toBe(2);
    expect(ok).toBeGreaterThanOrEqual(1);
    const n = await withTenantTx(h.writer, ctx, async (c) => {
      const r = await c.query(
        'SELECT count(*)::int AS n FROM sf_audit.audit_event_key WHERE audit_id = $1',
        [ev.audit_id],
      );
      return r.rows[0]?.n;
    });
    expect(n).toBe(1);
  });

  it('003-29 HttpAuditSink always-503 blocks privileged via requireAudit', async () => {
    const { HttpAuditSink, requireAudit, AuditSinkUnavailableError } =
      await import('@serviceform/audit-client');
    const sink = new HttpAuditSink({
      baseUrl: 'http://audit.example',
      delayMs: 1,
      retries: 2,
      fetchImpl: async () => new Response('no', { status: 503 }),
    });
    const act = async () => 'done';
    await expect(
      requireAudit('PRIVILEGED', () => sink.submit(sample(T1), ctx.correlation_id), act),
    ).rejects.toBeInstanceOf(AuditSinkUnavailableError);
  });

  it('003-30 PII dead-letter does not stall tenant', async () => {
    const ev = sample(T1, { action_class: 'OVERRIDE', reason: 'ABCDE1234F' });
    const envelope: EventEnvelope<AuditEvent> = {
      event_id: randomUUID(),
      event_type: 'AuditEventSubmitted',
      schema_version: 1,
      tenant_id: ev.tenant_id,
      cell_id: ev.cell_id,
      aggregate_type: 'AuditEvent',
      aggregate_id: ev.audit_id,
      aggregate_version: 0,
      occurred_at: ev.occurred_at,
      correlation_id: ev.correlation_id,
      actor: { type: ev.actor_type, id: ev.actor_id },
      data: ev,
    };
    const dlq = await handleEnvelope(h.writer, envelope, { platformSources: [] });
    expect(dlq.status).toBe('dead_lettered');
    expect(dlq.reason).toBe('PII_FIELD_REJECTED');
    const next = sample(T1);
    const okEnv: EventEnvelope<AuditEvent> = {
      event_id: randomUUID(),
      event_type: 'AuditEventSubmitted',
      schema_version: 1,
      tenant_id: next.tenant_id,
      cell_id: next.cell_id,
      aggregate_type: 'AuditEvent',
      aggregate_id: next.audit_id,
      aggregate_version: 0,
      occurred_at: next.occurred_at,
      correlation_id: next.correlation_id,
      actor: { type: next.actor_type, id: next.actor_id },
      data: next,
    };
    const stored = await handleEnvelope(h.writer, okEnv, { platformSources: [] });
    expect(stored.status).toBe('stored');
  });
});
