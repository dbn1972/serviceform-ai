import { assertEventFreeText, PiiRejectedError } from '@serviceform/audit-client';
import type { AuditEvent, RequestContext } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { assertClock } from '../domain/clock-guard.js';
import { AuditError, DuplicateContentError } from '../domain/errors.js';
import { appendLedger } from '../domain/ledger-writer.js';
import type { Metrics } from '../domain/metrics.js';
import type { AuthzPort } from '../ports/authz-port.js';
import { withTenantTx } from '../repo/tx.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function requireCtx(ctx: RequestContext | null): RequestContext {
  if (!ctx) throw new AuditError('SF-TEN-001', { statusCode: 401 });
  return ctx;
}

export function registerPostAuditEvent(
  app: FastifyInstance,
  deps: {
    pool: Pool;
    authz: AuthzPort;
    metrics: Metrics;
    clockSkewSeconds: number;
    now: () => Date;
  },
): void {
  app.post('/internal/audit-events', async (request, reply) => {
    const ctx = requireCtx(request.ctx);
    if (ctx.actor.type !== 'SYSTEM' && ctx.actor.type !== 'INTEGRATION') {
      throw new AuditError('SF-AUTH-002', { statusCode: 403 });
    }
    const decision = await deps.authz.decide({
      subject: {
        user_id: ctx.actor.id,
        actor_type: ctx.actor.type,
        tenant_id: ctx.tenant_id,
        roles: ctx.roles,
        jurisdiction_ids: ctx.jurisdiction_ids,
        assurance: ctx.auth_assurance,
      },
      resource: {
        resource_type: 'AuditEvent',
        tenant_id: ctx.tenant_id,
        classification: ctx.tenant_id ? 'TENANT_SCOPED' : 'PLATFORM_OPERATIONAL',
      },
      action: 'AUDIT_SUBMIT',
    });
    if (!decision.allow) throw new AuditError('SF-AUTH-002', { statusCode: 403 });

    const body = request.body;
    if (!isRecord(body)) {
      throw new AuditError('SF-SYS-003');
    }
    if (JSON.stringify(body).includes('\u0000')) {
      throw new AuditError('SF-SYS-003', { details: [{ code: 'NUL' }] });
    }
    const check = validate('audit-event', body);
    if (!check.valid) {
      throw new AuditError('SF-SYS-003', {
        details: [{ code: 'SCHEMA', message: 'not an AuditEvent' }],
      });
    }
    const event = body as unknown as AuditEvent;
    if (JSON.stringify(event).includes('\u0000')) {
      throw new AuditError('SF-SYS-003', { details: [{ code: 'NUL' }] });
    }
    try {
      assertEventFreeText(event);
    } catch (err) {
      if (err instanceof PiiRejectedError) {
        deps.metrics.piiRejected += 1;
        throw new AuditError('SF-SYS-003', {
          details: [{ code: 'PII_FIELD_REJECTED', pointer: err.pointer }],
        });
      }
      throw err;
    }
    if (event.tenant_id !== ctx.tenant_id) {
      throw new AuditError('SF-TEN-002', { statusCode: 403 });
    }
    const relay = ctx.actor.type === 'INTEGRATION' && ctx.purpose !== undefined;
    if (!relay) {
      if (
        event.actor_id !== ctx.actor.id ||
        event.actor_type !== ctx.actor.type ||
        event.cell_id !== ctx.cell_id ||
        event.correlation_id !== ctx.correlation_id
      ) {
        throw new AuditError('SF-AUTH-002', { statusCode: 403 });
      }
    } else if (event.tenant_id !== ctx.tenant_id) {
      throw new AuditError('SF-TEN-002', { statusCode: 403 });
    }
    assertClock(event.occurred_at, deps.now(), deps.clockSkewSeconds);
    const dropped = event.client_context !== undefined;
    if (dropped) deps.metrics.clientContextDropped += 1;
    const { client_context: _c, ...stored } = event;
    try {
      const result = await withTenantTx(deps.pool, ctx, (client) =>
        appendLedger(client, ctx, stored),
      );
      deps.metrics.ingest += 1;
      if (result.duplicate) deps.metrics.duplicates += 1;
      const payload = {
        audit_id: result.audit_id,
        chain_seq: result.chain_seq,
        recorded_at: result.recorded_at,
      };
      return reply.code(result.duplicate ? 200 : 201).send(payload);
    } catch (err) {
      if (err instanceof DuplicateContentError) throw err;
      const code = (err as { code?: string }).code;
      if (code === 'ECONNREFUSED' || code === '57P01' || code === '08006') {
        throw new AuditError('SF-SYS-004', { statusCode: 503, cause: err });
      }
      throw err;
    }
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext | null;
  }
}
