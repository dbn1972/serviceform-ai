import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthzDecisionInput, RequestContext } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import { authorize, type AuthorizationPort } from '../authz.js';
import { auditEvent, shouldWriteDeniedAudit, type AuditRecorder } from '../audit.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { withContextTx } from '../db/tx.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { Cmp005Error } from '../errors.js';
import type { ConsentAccessPort, DigiLockerPort, SubjectDirectoryPort } from '../ports.js';
import type { ConnectorBinding, DeploymentEnvironment } from '@serviceform/contracts';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  audit: AuditRecorder;
  clock: () => Date;
  consentAccess: ConsentAccessPort;
  subjectDirectory: SubjectDirectoryPort;
  digiLocker: DigiLockerPort;
  deploymentEnvironment: DeploymentEnvironment;
  digiLockerBinding: ConnectorBinding;
}

export async function decide(
  deps: RouteDeps,
  _ctx: RequestContext,
  input: AuthzDecisionInput,
): Promise<void> {
  await authorize(deps.authorizer, input);
}

export async function writeDenied(
  deps: RouteDeps,
  ctx: RequestContext,
  request: FastifyRequest,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  if (!shouldWriteDeniedAudit(ctx.actor.id, request.url, Date.now())) return;
  const event = auditEvent(ctx, {
    action,
    actionClass: 'PRIVILEGED',
    resourceType,
    resourceId,
    result: 'DENIED',
    reason: 'DENIED',
    now: deps.clock(),
  });
  try {
    await withContextTx(deps.pool, ctx, async (tx) => {
      await deps.audit.append(tx, event);
    });
  } catch {
    /* fail closed on the original deny */
  }
}

export function sendPrivate(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store');
}

export function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !IDEMPOTENCY_KEY.test(value)) {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY' }] });
  }
  return value;
}

export async function runCommand<T>(
  deps: RouteDeps,
  request: FastifyRequest,
  ctx: RequestContext,
  endpoint: string,
  run: (tx: PoolClient) => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const key = readIdempotencyKey(request);
  const fingerprint = requestFingerprint(request.method, endpoint, request.body);
  return withContextTx(deps.pool, ctx, async (tx) => {
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
  });
}

export async function withWriteAudit(
  deps: RouteDeps,
  ctx: RequestContext,
  tx: PoolClient,
  params: Parameters<typeof auditEvent>[1],
): Promise<void> {
  await deps.audit.append(tx, auditEvent(ctx, params));
}

export function requireTenant(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp005Error('SF-TEN-001', { statusCode: 401 });
  return ctx.tenant_id;
}

export async function requireConsent(
  deps: RouteDeps,
  tenantId: string,
  subjectId: string,
  purposeCode: string,
  correlationId: string,
): Promise<void> {
  let result: { allowed: boolean; reason_code: string };
  try {
    result = await deps.consentAccess.check({
      tenant_id: tenantId,
      subject_id: subjectId,
      purpose_code: purposeCode,
      correlation_id: correlationId,
    });
  } catch (err) {
    throw new Cmp005Error('SF-SYS-004', {
      details: [{ code: 'CONSENT_PORT_UNAVAILABLE' }],
      cause: err,
    });
  }
  if (!result.allowed) {
    throw new Cmp005Error('SF-AUTH-002', { details: [{ code: result.reason_code }] });
  }
}
