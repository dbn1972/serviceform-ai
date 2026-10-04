import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthzDecisionInput, RequestContext } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import { authorize, type AuthorizationPort } from '../authz.js';
import { auditEvent, type AuditRecorder } from '../audit.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp001Error } from '../errors.js';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  audit: AuditRecorder;
  clock: () => Date;
}

export function iso(clock: () => Date): string {
  return clock().toISOString();
}

export function subject(ctx: RequestContext) {
  return {
    user_id: ctx.actor.id,
    actor_type: ctx.actor.type,
    tenant_id: ctx.tenant_id,
    roles: ctx.roles,
    jurisdiction_ids: ctx.jurisdiction_ids,
    assurance: ctx.auth_assurance,
  };
}

export async function decide(
  deps: RouteDeps,
  _ctx: RequestContext,
  input: AuthzDecisionInput,
): Promise<void> {
  await authorize(deps.authorizer, input);
}

export function requirePrivileged(ctx: RequestContext): void {
  if (ctx.actor.type !== 'PRIVILEGED_ADMIN' || ctx.auth_assurance !== 'MFA') {
    throw new Cmp001Error('SF-AUTH-002');
  }
}

export function sendPrivate(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store');
}

export function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !IDEMPOTENCY_KEY.test(value)) {
    throw new Cmp001Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY' }] });
  }
  return value;
}

export async function runCommand<T>(
  deps: RouteDeps,
  request: FastifyRequest,
  ctx: RequestContext,
  endpoint: string,
  run: (tx: PoolClient) => Promise<{ status: number; body: T }>,
  extra?: { privilegedMarker?: string },
): Promise<{ status: number; body: T }> {
  const key = readIdempotencyKey(request);
  const fingerprint = requestFingerprint(request.method, endpoint, request.body);
  return withContextTx(
    deps.pool,
    ctx,
    async (tx) => {
      const claim = await claimIdempotency(tx, {
        tenantId: ctx.tenant_id,
        principalId: ctx.actor.id,
        endpoint,
        key,
        fingerprint,
        now: deps.clock(),
      });
      if (claim !== 'claimed') return { status: claim.status, body: claim.body as T };
      const result = await run(tx);
      await completeIdempotency(tx, {
        tenantId: ctx.tenant_id,
        principalId: ctx.actor.id,
        endpoint,
        key,
        status: result.status,
        body: result.body,
      });
      return result;
    },
    extra,
  );
}

export async function withWriteAudit(
  deps: RouteDeps,
  ctx: RequestContext,
  tx: PoolClient,
  params: Parameters<typeof auditEvent>[1],
): Promise<void> {
  await deps.audit.append(tx, auditEvent(ctx, params));
}

export async function emitDomain(
  tx: PoolClient,
  ctx: RequestContext,
  params: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    occurredAt: string;
    data: object;
  },
): Promise<void> {
  const env = envelopeOf({
    eventType: params.eventType,
    tenantId: ctx.tenant_id,
    cellId: ctx.cell_id,
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    aggregateVersion: params.aggregateVersion,
    occurredAt: params.occurredAt,
    correlationId: ctx.correlation_id,
    actor: ctx.actor,
    data: params.data,
  });
  await insertOutbox(tx, env, TOPIC_DOMAIN);
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      last?: unknown;
    };
    if (typeof parsed.last !== 'string' || !isUuid(parsed.last)) {
      throw new Error('bad');
    }
    return parsed.last;
  } catch {
    throw new Cmp001Error('SF-SYS-003', { details: [{ code: 'CURSOR' }] });
  }
}

export function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ last: id }), 'utf8').toString('base64url');
}
