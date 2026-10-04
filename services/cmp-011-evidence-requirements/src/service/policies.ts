import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { isPolicyKey, sha256Of } from '../domain/canonical.js';
import { parsePolicyDefinition } from '../domain/policy.js';
import { Cmp011Error, mapPgError } from '../errors.js';
import type { ApprovalPort } from '../ports/approval.js';
import {
  getPolicy,
  insertPolicy,
  markPolicyPublished,
  nextVersionNo,
  updateDraftPolicy,
  type PolicyRow,
} from '../repo/evidence-repo.js';

export function policyPublic(row: PolicyRow) {
  return {
    policy_id: row.policy_id,
    policy_key: row.policy_key,
    status: row.status,
    version_no: row.version_no === null ? null : Number(row.version_no),
    version_ref: row.version_ref,
    content_hash: row.content_hash,
    definition: row.definition,
    aggregate_version: Number(row.aggregate_version),
  };
}

function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp011Error('SF-TEN-001');
  return ctx.tenant_id;
}

function policyEvent(row: PolicyRow, eventType: string, ctx: RequestContext, now: Date) {
  return envelopeOf({
    eventType,
    tenantId: row.tenant_id,
    cellId: ctx.cell_id,
    aggregateType: 'EvidencePolicy',
    aggregateId: row.policy_id,
    aggregateVersion: Number(row.aggregate_version),
    occurredAt: now.toISOString(),
    correlationId: ctx.correlation_id,
    actor: ctx.actor,
    data: {
      policy_id: row.policy_id,
      policy_key: row.policy_key,
      content_hash: row.content_hash,
      status: row.status,
      ...(row.version_ref ? { version_ref: row.version_ref } : {}),
    },
  });
}

export async function createPolicy(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  input: { policy_key: string; definition: unknown },
) {
  const tenantId = tenantOf(deps.ctx);
  if (!isPolicyKey(input.policy_key)) {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'INVALID_POLICY_KEY' }] });
  }
  const definition = parsePolicyDefinition(input.definition);
  let row: PolicyRow;
  try {
    row = await insertPolicy(client, {
      policyId: randomUUID(),
      tenantId,
      cellId: deps.ctx.cell_id,
      policyKey: input.policy_key,
      definition,
      contentHash: sha256Of(definition),
      createdBy: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  await insertOutbox(client, policyEvent(row, 'EvidencePolicyCreated', deps.ctx, deps.now));
  await appendAudit(client, deps.ctx, {
    action: 'EVIDENCE_POLICY_CREATE',
    actionClass: 'WRITE',
    resourceType: 'EvidencePolicy',
    resourceId: row.policy_id,
    result: 'SUCCESS',
    now: deps.now,
  });
  return policyPublic(row);
}

export async function readPolicy(client: PoolClient, ctx: RequestContext, policyId: string) {
  const row = await getPolicy(client, tenantOf(ctx), policyId);
  if (!row) throw new Cmp011Error('SF-APP-001', { statusCode: 404 });
  return policyPublic(row);
}

export async function patchPolicy(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  policyId: string,
  input: { definition: unknown },
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getPolicy(client, tenantId, policyId);
  if (!existing) throw new Cmp011Error('SF-APP-001', { statusCode: 404 });
  if (existing.status === 'PUBLISHED') {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  const definition = parsePolicyDefinition(input.definition);
  let row: PolicyRow | undefined;
  try {
    row = await updateDraftPolicy(client, {
      tenantId,
      policyId,
      definition,
      contentHash: sha256Of(definition),
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  await insertOutbox(client, policyEvent(row, 'EvidencePolicyUpdated', deps.ctx, deps.now));
  return policyPublic(row);
}

export async function publishPolicy(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date; approval: ApprovalPort },
  policyId: string,
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getPolicy(client, tenantId, policyId);
  if (!existing) throw new Cmp011Error('SF-APP-001', { statusCode: 404 });
  if (existing.status === 'PUBLISHED') {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  await deps.approval.requireApproved({ policyId, proposedHash: existing.content_hash });
  const versionNo = await nextVersionNo(client, tenantId, existing.policy_key);
  let row: PolicyRow | undefined;
  try {
    row = await markPolicyPublished(client, {
      tenantId,
      policyId,
      versionNo,
      versionRef: `${existing.policy_key}@${versionNo}`,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  await insertOutbox(client, policyEvent(row, 'EvidencePolicyPublished', deps.ctx, deps.now));
  await appendAudit(client, deps.ctx, {
    action: 'EVIDENCE_POLICY_PUBLISH',
    actionClass: 'WRITE',
    resourceType: 'EvidencePolicy',
    resourceId: row.policy_id,
    result: 'SUCCESS',
    now: deps.now,
  });
  return policyPublic(row);
}
