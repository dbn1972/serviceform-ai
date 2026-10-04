import { randomUUID } from 'node:crypto';
import type { RequestContext, SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { isContentHash, isUuid } from '../domain/ids.js';
import { Cmp051Error, mapPgError } from '../errors.js';
import type { AiValidationPort } from '../ports/ai-validation.js';
import type { MetadataPort } from '../ports/metadata.js';
import type { VersioningPort } from '../ports/versioning.js';
import {
  getRequest,
  insertRequest,
  markDecided,
  markSubmitted,
  type RequestRow,
} from '../repo/request-repo.js';

export function requestPublic(row: RequestRow, simulation?: SimulationMarker) {
  const body: Record<string, unknown> = {
    request_id: row.request_id,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    proposed_hash: row.proposed_hash,
    status: row.status,
    maker_principal_id: row.maker_principal_id,
    checker_principal_id: row.checker_principal_id,
    aggregate_version: Number(row.aggregate_version),
    ai_advisory: row.ai_advisory,
  };
  if (simulation) body['simulation'] = simulation;
  return body;
}

function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp051Error('SF-TEN-001');
  return ctx.tenant_id;
}

function lifecycleEvent(row: RequestRow, eventType: string, ctx: RequestContext, now: Date) {
  return envelopeOf({
    eventType,
    tenantId: row.tenant_id,
    cellId: ctx.cell_id,
    aggregateType: 'PublicationRequest',
    aggregateId: row.request_id,
    aggregateVersion: Number(row.aggregate_version),
    occurredAt: now.toISOString(),
    correlationId: ctx.correlation_id,
    actor: ctx.actor,
    data: {
      request_id: row.request_id,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      proposed_hash: row.proposed_hash,
      status: row.status,
    },
  });
}

export async function createRequest(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date; metadata: MetadataPort; versioning: VersioningPort },
  input: { subject_id: string; proposed_hash: string },
) {
  const tenantId = tenantOf(deps.ctx);
  if (!isUuid(input.subject_id) || !isContentHash(input.proposed_hash)) {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'INVALID_SUBJECT' }] });
  }
  const meta = await deps.metadata.assertPublishable({ proposedHash: input.proposed_hash });
  const confirmed = await deps.versioning.confirmHash({
    bindingId: input.subject_id,
    proposedHash: input.proposed_hash,
  });
  if (confirmed.artifact_hash !== input.proposed_hash) {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'HASH_MISMATCH' }] });
  }
  let row: RequestRow;
  try {
    row = await insertRequest(client, {
      requestId: randomUUID(),
      tenantId,
      cellId: deps.ctx.cell_id,
      subjectId: input.subject_id,
      proposedHash: input.proposed_hash,
      makerId: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  await insertOutbox(client, lifecycleEvent(row, 'PublicationRequestCreated', deps.ctx, deps.now));
  await appendAudit(client, deps.ctx, {
    action: 'PUBLICATION_REQUEST_CREATE',
    actionClass: 'WRITE',
    resourceType: 'PublicationRequest',
    resourceId: row.request_id,
    result: 'SUCCESS',
    now: deps.now,
  });
  return requestPublic(row, meta.simulation ?? confirmed.simulation);
}

export async function readRequest(client: PoolClient, ctx: RequestContext, requestId: string) {
  const row = await getRequest(client, tenantOf(ctx), requestId);
  if (!row) throw new Cmp051Error('SF-APP-001', { statusCode: 404 });
  return requestPublic(row);
}

export async function submitRequest(
  client: PoolClient,
  deps: {
    ctx: RequestContext;
    now: Date;
    metadata: MetadataPort;
    versioning: VersioningPort;
    ai: AiValidationPort;
  },
  requestId: string,
  reason: string | undefined,
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getRequest(client, tenantId, requestId);
  if (!existing) throw new Cmp051Error('SF-APP-001', { statusCode: 404 });
  if (existing.status !== 'DRAFT') {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'NOT_DRAFT' }] });
  }
  await deps.metadata.assertPublishable({ proposedHash: existing.proposed_hash });
  await deps.versioning.confirmHash({
    bindingId: existing.subject_id,
    proposedHash: existing.proposed_hash,
  });
  const advisory = await deps.ai.review({
    requestId,
    proposedHash: existing.proposed_hash,
  });
  let row: RequestRow | undefined;
  try {
    row = await markSubmitted(client, {
      tenantId,
      requestId,
      reason: reason ?? null,
      aiAdvisory: {
        skipped: advisory.skipped,
        finding_count: advisory.finding_count,
        codes: advisory.codes,
      },
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'NOT_DRAFT' }] });
  await insertOutbox(
    client,
    lifecycleEvent(row, 'PublicationRequestSubmitted', deps.ctx, deps.now),
  );
  await appendAudit(client, deps.ctx, {
    action: 'PUBLICATION_REQUEST_SUBMIT',
    actionClass: 'WRITE',
    resourceType: 'PublicationRequest',
    resourceId: row.request_id,
    result: 'SUCCESS',
    now: deps.now,
  });
  return requestPublic(row, advisory.simulation);
}

export async function decideRequest(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  requestId: string,
  decision: 'APPROVED' | 'REJECTED',
  reason: string,
) {
  const tenantId = tenantOf(deps.ctx);
  if (reason.trim().length < 1 || reason.length > 1000) {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'DECISION_REASON_REQUIRED' }] });
  }
  const existing = await getRequest(client, tenantId, requestId);
  if (!existing) throw new Cmp051Error('SF-APP-001', { statusCode: 404 });
  if (existing.status !== 'SUBMITTED') {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'NOT_SUBMITTED' }] });
  }
  if (deps.ctx.actor.id === existing.maker_principal_id) {
    throw new Cmp051Error('SF-AUTH-002', { details: [{ code: 'MAKER_CANNOT_DECIDE' }] });
  }
  let row: RequestRow | undefined;
  try {
    row = await markDecided(client, {
      tenantId,
      requestId,
      status: decision,
      checkerId: deps.ctx.actor.id,
      reason,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'NOT_SUBMITTED' }] });
  const eventType =
    decision === 'APPROVED' ? 'PublicationRequestApproved' : 'PublicationRequestRejected';
  await insertOutbox(client, lifecycleEvent(row, eventType, deps.ctx, deps.now));
  await appendAudit(client, deps.ctx, {
    action: decision === 'APPROVED' ? 'PUBLICATION_REQUEST_APPROVE' : 'PUBLICATION_REQUEST_REJECT',
    actionClass: 'DECISION',
    resourceType: 'PublicationRequest',
    resourceId: row.request_id,
    result: 'SUCCESS',
    reason,
    now: deps.now,
  });
  return requestPublic(row);
}
