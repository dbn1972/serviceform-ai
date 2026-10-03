import { describe, expect, it } from 'vitest';
import { handleEnvelope } from '../../src/consumer/handle-envelope.js';
import { assertClock } from '../../src/domain/clock-guard.js';
import { AuditError } from '../../src/domain/errors.js';
import { encodeCursor, parseAuditQuery } from '../../src/domain/query-filters.js';
import { assertCellId, loadConfig } from '../../src/config.js';
import { denyAllAuthz } from '../../src/ports/authz-port.js';
import type { AuditEvent, EventEnvelope } from '@serviceform/contracts';
import type { Pool } from 'pg';

const ev: AuditEvent = {
  audit_id: 'c06d4ebf-17d3-4a5f-a8c0-f3be9fd17c4c',
  occurred_at: '2026-10-03T09:00:00Z',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  cell_id: 'cell-01',
  actor_type: 'SYSTEM',
  actor_id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42',
  action: 'EXAMPLE_WRITE',
  resource_type: 'ExampleAggregate',
  resource_id: 'res-1',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
  result: 'SUCCESS',
};

function envelope(over: Partial<EventEnvelope<AuditEvent>> = {}): EventEnvelope<AuditEvent> {
  return {
    event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
    ...over,
  };
}

describe('handleEnvelope contract rejects (003-21)', () => {
  const pool = {} as Pool;
  it('dead-letters wrong event_type, version, aggregate, extra keys, correlation', async () => {
    expect(
      (await handleEnvelope(pool, envelope({ event_type: 'Nope' }), { platformSources: [] }))
        .status,
    ).toBe('dead_lettered');
    expect(
      (await handleEnvelope(pool, envelope({ schema_version: 2 }), { platformSources: [] })).reason,
    ).toBe('SCHEMA_VERSION');
    expect(
      (await handleEnvelope(pool, envelope({ aggregate_type: 'Other' }), { platformSources: [] }))
        .reason,
    ).toBe('AGGREGATE_TYPE');
    expect(
      (
        await handleEnvelope(
          pool,
          envelope({ aggregate_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
          { platformSources: [] },
        )
      ).reason,
    ).toBe('AGGREGATE_ID');
    expect(
      (
        await handleEnvelope(
          pool,
          envelope({ correlation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
          {
            platformSources: [],
          },
        )
      ).reason,
    ).toBe('CORRELATION_MISMATCH');
    const extra = envelope();
    extra.data = { ...ev, aadhaar_number: 'x' } as unknown as AuditEvent;
    expect((await handleEnvelope(pool, extra, { platformSources: [] })).reason).toBe(
      'INVALID_EVENT',
    );
  });
});

describe('config and authz', () => {
  it('loads defaults and rejects bad cell id', () => {
    expect(loadConfig().queryMaxLimit).toBe(200);
    expect(loadConfig().rateLimitMax).toBe(60);
    expect(loadConfig().rateLimitWindowMs).toBe(60_000);
    expect(() => assertCellId('nope')).toThrow();
    expect(() => assertCellId('cell-01')).not.toThrow();
  });
  it('deny-all authz', async () => {
    const d = await denyAllAuthz().decide({
      subject: {
        user_id: ev.actor_id,
        actor_type: 'SYSTEM',
        tenant_id: ev.tenant_id,
        roles: [],
        jurisdiction_ids: [],
      },
      resource: { resource_type: 'AuditEvent', tenant_id: ev.tenant_id },
      action: 'AUDIT_READ',
    });
    expect(d.allow).toBe(false);
  });
});

describe('query cursor', () => {
  it('round-trips and rejects T2-looking garbage', () => {
    const c = encodeCursor('2026-10-03T00:00:00.000Z', 3);
    const q = parseAuditQuery(
      { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z', cursor: c },
      31,
      200,
    );
    expect(q.cursor?.chain_seq).toBe(3);
    expect(() =>
      parseAuditQuery(
        { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z', cursor: '!!!' },
        31,
        200,
      ),
    ).toThrow(AuditError);
    expect(() =>
      parseAuditQuery(
        { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z', resource_type: 'Example%' },
        31,
        200,
      ),
    ).toThrow(AuditError);
  });
});

describe('clock', () => {
  it('accepts historical occurred_at', () => {
    expect(() =>
      assertClock('2026-09-01T00:00:00Z', new Date('2026-10-03T00:00:00Z'), 300),
    ).not.toThrow();
  });
});

describe('plugin HTTP without context', () => {
  it('POST and GET return 401 when resolver returns null', async () => {
    const Fastify = (await import('fastify')).default;
    const { createLogger } = await import('@serviceform/observability');
    const { registerAuditPlugin } = await import('../../src/plugin.js');
    const { Writable } = await import('node:stream');
    const dest = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    const app = Fastify({ logger: false });
    await registerAuditPlugin(app, {
      pool: {} as Pool,
      resolveRequestContext: () => null,
      logger: createLogger({ service: 'cmp-031', version: '0', destination: dest }),
    });
    await app.ready();
    const post = await app.inject({
      method: 'POST',
      url: '/v1/internal/audit-events',
      payload: {},
    });
    expect(post.statusCode).toBe(401);
    const get = await app.inject({
      method: 'GET',
      url: '/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z',
    });
    expect(get.statusCode).toBe(401);
    const byRes = await app.inject({ method: 'GET', url: '/v1/audit/ExampleAggregate/x' });
    expect(byRes.statusCode).toBe(401);
    await app.close();
  });

  it('GET /audit is rate-limited with SF-RATE-001', async () => {
    const Fastify = (await import('fastify')).default;
    const { createLogger } = await import('@serviceform/observability');
    const { registerAuditPlugin } = await import('../../src/plugin.js');
    const { Writable } = await import('node:stream');
    const dest = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    const app = Fastify({ logger: false });
    await registerAuditPlugin(app, {
      pool: {} as Pool,
      resolveRequestContext: () => null,
      logger: createLogger({ service: 'cmp-031', version: '0', destination: dest }),
      config: {
        clockSkewSeconds: 300,
        queryMaxDays: 31,
        queryMaxLimit: 200,
        cellId: 'cell-01',
        rateLimitMax: 1,
        rateLimitWindowMs: 60_000,
      },
    });
    await app.ready();
    const first = await app.inject({
      method: 'GET',
      url: '/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z',
    });
    expect(first.statusCode).toBe(401);
    const second = await app.inject({
      method: 'GET',
      url: '/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z',
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error_code: 'SF-RATE-001' });
    await app.close();
  });

  it('query target_tenant_id cannot skip AUDIT_READ', async () => {
    const Fastify = (await import('fastify')).default;
    const { createLogger } = await import('@serviceform/observability');
    const { registerAuditPlugin } = await import('../../src/plugin.js');
    const { Writable } = await import('node:stream');
    const dest = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    const app = Fastify({ logger: false });
    await registerAuditPlugin(app, {
      pool: {} as Pool,
      resolveRequestContext: () => ({
        tenant_id: ev.tenant_id,
        cell_id: ev.cell_id,
        actor: { type: 'OFFICER', id: ev.actor_id },
        roles: ['AUDITOR'],
        jurisdiction_ids: [],
        auth_assurance: 'MFA',
        correlation_id: ev.correlation_id,
        trace_id: ev.trace_id,
      }),
      logger: createLogger({ service: 'cmp-031', version: '0', destination: dest }),
    });
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z&target_tenant_id=${ev.tenant_id ?? ''}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    await app.close();
  });
});
