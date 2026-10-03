import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@serviceform/observability';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { createMetrics } from '../../src/domain/metrics.js';
import { denyAllAuthz, type AuthzPort } from '../../src/ports/authz-port.js';
import { registerAuditPlugin } from '../../src/plugin.js';
import {
  ACTOR,
  allowAuthz,
  sampleEvent,
  submittedEnvelope,
  systemCtx,
  T1,
} from '../support/fixtures.js';
import { createLedgerState, createMockPool } from '../support/mock-pool.js';

const dest = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});

async function buildApp(opts: {
  ctx: RequestContext | null | (() => RequestContext | null);
  authz?: AuthzPort;
  connectError?: Error;
  failSql?: (sql: string) => Error | undefined;
  rateLimitMax?: number;
}) {
  const state = createLedgerState({
    ...(opts.connectError ? { connectError: opts.connectError } : {}),
    ...(opts.failSql ? { failSql: opts.failSql } : {}),
  });
  const app = Fastify({ logger: false });
  await registerAuditPlugin(app, {
    pool: createMockPool(state),
    resolveRequestContext: () => (typeof opts.ctx === 'function' ? opts.ctx() : opts.ctx),
    authz: opts.authz ?? allowAuthz(),
    logger: createLogger({ service: 'cmp-031', version: '0', destination: dest }),
    clock: () => new Date('2026-10-03T12:00:00Z'),
    platformSources: ['sf-source-platform'],
    config: {
      ...loadConfig(),
      rateLimitMax: opts.rateLimitMax ?? 10_000,
      rateLimitWindowMs: 60_000,
    },
  });
  await app.ready();
  return { app, state };
}

const RANGE = 'from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z';

describe('POST /v1/internal/audit-events', () => {
  it('rejects officer actors, deny-all authz, and tenant mismatch', async () => {
    const officer = systemCtx(T1);
    officer.actor = { type: 'OFFICER', id: ACTOR };
    const { app: officerApp } = await buildApp({ ctx: officer });
    const officerRes = await officerApp.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent(),
    });
    expect(officerRes.statusCode).toBe(403);
    await officerApp.close();

    const { app: denyApp } = await buildApp({ ctx: systemCtx(T1), authz: denyAllAuthz() });
    const denyRes = await denyApp.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent(),
    });
    expect(denyRes.statusCode).toBe(403);
    expect(denyRes.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    await denyApp.close();

    const { app } = await buildApp({ ctx: systemCtx(T1) });
    const mismatch = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({ tenant_id: '22222222-2222-4222-8222-222222222222' }),
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    await app.close();
  });

  it('rejects invalid payloads, NUL bytes, PII, actor binding, and clock skew', async () => {
    const { app } = await buildApp({ ctx: systemCtx(T1) });
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      headers: { 'content-type': 'application/json' },
      payload: 'true',
    });
    expect(empty.statusCode).toBe(400);

    const schema = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: { hello: 'world' },
    });
    expect(schema.statusCode).toBe(400);
    expect(schema.json()).toMatchObject({ error_code: 'SF-SYS-003' });

    const nul = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({ action: 'EXAMPLE_WRITE\u0000' }),
    });
    expect(nul.statusCode).toBe(400);

    const pii = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({ reason: 'email user@example.com' }),
    });
    expect(pii.statusCode).toBe(400);
    expect(pii.json().details).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PII_FIELD_REJECTED' })]),
    );

    const actor = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({ actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    });
    expect(actor.statusCode).toBe(403);

    const skew = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({ occurred_at: '2026-10-04T12:00:00Z' }),
    });
    expect(skew.statusCode).toBe(400);
    await app.close();
  });

  it('stores, is idempotent on retry, and conflicts on content change', async () => {
    const { app, state } = await buildApp({ ctx: systemCtx(T1) });
    const body = sampleEvent({ client_context: { source_ip: '203.0.113.10' } });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ audit_id: body.audit_id, chain_seq: 1 });
    expect(state.tenantEvents[0]?.record.client_context).toBeUndefined();
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent(),
    });
    expect(retry.statusCode).toBe(200);
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({ action: 'OTHER_WRITE' }),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error_code: 'SF-APP-002' });
    await app.close();
  });

  it('allows INTEGRATION relay when purpose is set and maps DB failures to 503', async () => {
    const relay = systemCtx(T1);
    relay.actor = { type: 'INTEGRATION', id: ACTOR };
    relay.purpose = 'batch-replay';
    const { app } = await buildApp({ ctx: relay });
    const stored = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({
        actor_type: 'OFFICER',
        actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    });
    expect(stored.statusCode).toBe(201);
    await app.close();

    const bound = systemCtx(T1);
    bound.actor = { type: 'INTEGRATION', id: ACTOR };
    const { app: boundApp } = await buildApp({ ctx: bound });
    const mismatch = await boundApp.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent({
        actor_type: 'OFFICER',
        actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    });
    expect(mismatch.statusCode).toBe(403);
    await boundApp.close();

    const down = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    const { app: downApp } = await buildApp({ ctx: systemCtx(T1), connectError: down });
    const unavailable = await downApp.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent(),
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ error_code: 'SF-SYS-004' });
    await downApp.close();

    const terminating = Object.assign(new Error('admin shutdown'), { code: '57P01' });
    const { app: termApp } = await buildApp({ ctx: systemCtx(T1), connectError: terminating });
    expect(
      (
        await termApp.inject({
          method: 'POST',
          url: '/v1/internal/audit-events',
          payload: sampleEvent(),
        })
      ).statusCode,
    ).toBe(503);
    await termApp.close();

    const broken = Object.assign(new Error('conn'), { code: '08006' });
    const { app: brokenApp } = await buildApp({ ctx: systemCtx(T1), connectError: broken });
    expect(
      (
        await brokenApp.inject({
          method: 'POST',
          url: '/v1/internal/audit-events',
          payload: sampleEvent(),
        })
      ).statusCode,
    ).toBe(503);
    await brokenApp.close();
  });

  it('maps unhandled errors to SF-SYS-001', async () => {
    const { app } = await buildApp({
      ctx: systemCtx(T1),
      connectError: new Error('boom'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: sampleEvent(),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error_code: 'SF-SYS-001' });
    await app.close();
  });
});

describe('GET /v1/audit', () => {
  it('returns the caller tenant page and writes an AUDIT_READ event', async () => {
    const { app, state } = await buildApp({ ctx: systemCtx(T1) });
    const res = await app.inject({ method: 'GET', url: `/v1/audit?${RANGE}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: expect.any(Array) });
    expect(state.tenantEvents.some((row) => row.record.action === 'AUDIT_READ')).toBe(true);
    await app.close();
  });

  it('denies a platform session even when a target_tenant_id is supplied', async () => {
    const { app, state } = await buildApp({ ctx: systemCtx(null) });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit?${RANGE}&target_tenant_id=${T1}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(state.platformEvents.some((row) => row.record.result === 'DENIED')).toBe(true);
    await app.close();
  });

  it('still 403s when the platform deny audit write fails', async () => {
    const { app } = await buildApp({
      ctx: systemCtx(null),
      failSql: (sql) =>
        sql.includes('audit_event_platform') ? new Error('denied-write') : undefined,
    });
    const res = await app.inject({ method: 'GET', url: `/v1/audit?${RANGE}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('rejects an invalid query range', async () => {
    const { app } = await buildApp({ ctx: systemCtx(T1) });
    const res = await app.inject({ method: 'GET', url: '/v1/audit?from=nope&to=also-nope' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /v1/audit/:resourceType/:id', () => {
  it('rejects traversal ids, invalid types, and platform sessions', async () => {
    const { app } = await buildApp({ ctx: systemCtx(T1) });
    expect((await app.inject({ method: 'GET', url: '/v1/audit/example/x' })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/audit/ExampleAggregate/..secret' })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/audit/ExampleAggregate/ok%252fetc' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/audit/ExampleAggregate/ok%252Fetc' }))
        .statusCode,
    ).toBe(400);
    await app.close();

    const { app: plat } = await buildApp({ ctx: systemCtx(null) });
    const denied = await plat.inject({ method: 'GET', url: '/v1/audit/ExampleAggregate/res-1' });
    expect(denied.statusCode).toBe(401);
    await plat.close();
  });

  it('lists a resource when AUDIT_READ is allowed', async () => {
    const { app, state } = await buildApp({ ctx: systemCtx(T1) });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit/ExampleAggregate/res-1?${RANGE}`,
    });
    expect(res.statusCode).toBe(200);
    expect(state.tenantEvents.some((row) => row.record.resource_id === 'res-1')).toBe(true);
    const defaults = await app.inject({ method: 'GET', url: '/v1/audit/ExampleAggregate/res-1' });
    expect(defaults.statusCode).toBe(200);
    await app.close();
  });

  it('denies when authz rejects the resource read', async () => {
    const { app } = await buildApp({ ctx: systemCtx(T1), authz: denyAllAuthz() });
    const res = await app.inject({ method: 'GET', url: '/v1/audit/ExampleAggregate/res-1' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('plugin decorations', () => {
  it('exposes metrics and routes envelopes through handleAuditEnvelope', async () => {
    const { app } = await buildApp({ ctx: systemCtx(T1) });
    expect(createMetrics()).toMatchObject({ ingest: 0, duplicates: 0 });
    expect(app.auditMetrics.ingest).toBe(0);
    const stored = await app.handleAuditEnvelope(submittedEnvelope());
    expect(stored.status).toBe('stored');
    const sourced = await app.handleAuditEnvelope(submittedEnvelope(), 'sf-source-platform');
    expect(sourced.status).toBe('already_applied');
    await app.close();
  });
});
