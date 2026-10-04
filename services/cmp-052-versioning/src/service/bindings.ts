import { randomUUID } from 'node:crypto';
import type { RequestContext, SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import {
  artifactHash,
  dependencyGraph,
  isBindingKey,
  parsePins,
  type PinMap,
} from '../domain/pins.js';
import { Cmp052Error, mapPgError } from '../errors.js';
import type { ApprovalPort } from '../ports/approval.js';
import {
  getArtifact,
  getBinding,
  insertArtifact,
  insertBinding,
  markBindingPublished,
  nextVersionNo,
  updateDraftBinding,
  type ArtifactRow,
  type BindingRow,
} from '../repo/version-repo.js';

export function bindingPublic(row: BindingRow, simulation?: SimulationMarker) {
  const body: Record<string, unknown> = {
    binding_id: row.binding_id,
    binding_key: row.binding_key,
    offering_ref: row.offering_ref,
    metadata_bundle_ref: row.metadata_bundle_ref,
    pins: row.pins,
    dependency_graph: row.dependency_graph,
    artifact_hash: row.artifact_hash,
    status: row.status,
    published_version_id: row.published_version_id,
    aggregate_version: Number(row.aggregate_version),
  };
  if (simulation) body['simulation'] = simulation;
  return body;
}

export function artifactPublic(row: ArtifactRow) {
  return {
    version_id: row.version_id,
    artifact_kind: row.artifact_kind,
    artifact_key: row.artifact_key,
    version_no: Number(row.version_no),
    content_hash: row.content_hash,
    dependency_graph: row.dependency_graph,
    source_binding_id: row.source_binding_id,
    status: row.status,
  };
}

function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp052Error('SF-TEN-001');
  return ctx.tenant_id;
}

function bindingEvent(row: BindingRow, eventType: string, ctx: RequestContext, now: Date) {
  return envelopeOf({
    eventType,
    tenantId: row.tenant_id,
    cellId: ctx.cell_id,
    aggregateType: 'TenantServiceBinding',
    aggregateId: row.binding_id,
    aggregateVersion: Number(row.aggregate_version),
    occurredAt: now.toISOString(),
    correlationId: ctx.correlation_id,
    actor: ctx.actor,
    data: {
      binding_id: row.binding_id,
      binding_key: row.binding_key,
      artifact_hash: row.artifact_hash,
      status: row.status,
      ...(row.published_version_id ? { published_version_id: row.published_version_id } : {}),
    },
  });
}

export async function createBinding(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  input: {
    binding_key: string;
    offering_ref: string;
    metadata_bundle_ref: string;
    pins: unknown;
  },
) {
  const tenantId = tenantOf(deps.ctx);
  if (!isBindingKey(input.binding_key)) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'INVALID_BINDING_KEY' }] });
  }
  if (input.offering_ref.length < 1 || input.offering_ref.length > 200) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'INVALID_OFFERING_REF' }] });
  }
  if (input.metadata_bundle_ref.length < 1 || input.metadata_bundle_ref.length > 200) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'INVALID_BUNDLE_REF' }] });
  }
  const pins = parsePins(input.pins);
  const graph = dependencyGraph(pins);
  const hash = artifactHash({
    binding_key: input.binding_key,
    offering_ref: input.offering_ref,
    metadata_bundle_ref: input.metadata_bundle_ref,
    pins,
  });
  let row: BindingRow;
  try {
    row = await insertBinding(client, {
      bindingId: randomUUID(),
      tenantId,
      cellId: deps.ctx.cell_id,
      bindingKey: input.binding_key,
      offeringRef: input.offering_ref,
      metadataBundleRef: input.metadata_bundle_ref,
      pins,
      dependencyGraph: graph,
      artifactHash: hash,
      createdBy: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  await insertOutbox(client, bindingEvent(row, 'TenantServiceBindingCreated', deps.ctx, deps.now));
  await appendAudit(client, deps.ctx, {
    action: 'TENANT_SERVICE_BINDING_CREATE',
    actionClass: 'WRITE',
    resourceType: 'TenantServiceBinding',
    resourceId: row.binding_id,
    result: 'SUCCESS',
    now: deps.now,
  });
  return bindingPublic(row);
}

export async function readBinding(client: PoolClient, ctx: RequestContext, bindingId: string) {
  const row = await getBinding(client, tenantOf(ctx), bindingId);
  if (!row) throw new Cmp052Error('SF-APP-001', { statusCode: 404 });
  return bindingPublic(row);
}

export async function patchBinding(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  bindingId: string,
  input: { offering_ref?: string; metadata_bundle_ref?: string; pins?: unknown },
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getBinding(client, tenantId, bindingId);
  if (!existing) throw new Cmp052Error('SF-APP-001', { statusCode: 404 });
  if (existing.status === 'PUBLISHED') {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  const offeringRef = input.offering_ref ?? existing.offering_ref;
  const bundleRef = input.metadata_bundle_ref ?? existing.metadata_bundle_ref;
  const pins = input.pins !== undefined ? parsePins(input.pins) : (existing.pins as PinMap);
  const graph = dependencyGraph(pins);
  const hash = artifactHash({
    binding_key: existing.binding_key,
    offering_ref: offeringRef,
    metadata_bundle_ref: bundleRef,
    pins,
  });
  let row: BindingRow | undefined;
  try {
    row = await updateDraftBinding(client, {
      tenantId,
      bindingId,
      offeringRef,
      metadataBundleRef: bundleRef,
      pins,
      dependencyGraph: graph,
      artifactHash: hash,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  await insertOutbox(client, bindingEvent(row, 'TenantServiceBindingUpdated', deps.ctx, deps.now));
  return bindingPublic(row);
}

export async function publishBinding(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date; approval: ApprovalPort },
  bindingId: string,
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getBinding(client, tenantId, bindingId);
  if (!existing) throw new Cmp052Error('SF-APP-001', { statusCode: 404 });
  if (existing.status === 'PUBLISHED') {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  const approved = await deps.approval.requireApproved({
    bindingId,
    proposedHash: existing.artifact_hash,
  });
  const versionNo = await nextVersionNo(client, tenantId, existing.binding_key);
  const versionId = randomUUID();
  let artifact: ArtifactRow;
  try {
    artifact = await insertArtifact(client, {
      versionId,
      tenantId,
      cellId: deps.ctx.cell_id,
      artifactKey: existing.binding_key,
      versionNo,
      contentHash: existing.artifact_hash,
      dependencyGraph: existing.dependency_graph,
      sourceBindingId: existing.binding_id,
      createdBy: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  let row: BindingRow | undefined;
  try {
    row = await markBindingPublished(client, {
      tenantId,
      bindingId,
      versionId: artifact.version_id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  await insertOutbox(
    client,
    bindingEvent(row, 'TenantServiceBindingPublished', deps.ctx, deps.now),
  );
  await insertOutbox(
    client,
    envelopeOf({
      eventType: 'ArtifactVersionPublished',
      tenantId,
      cellId: deps.ctx.cell_id,
      aggregateType: 'ArtifactVersion',
      aggregateId: artifact.version_id,
      aggregateVersion: Number(artifact.version_no),
      occurredAt: deps.now.toISOString(),
      correlationId: deps.ctx.correlation_id,
      actor: deps.ctx.actor,
      data: {
        version_id: artifact.version_id,
        artifact_key: artifact.artifact_key,
        version_no: Number(artifact.version_no),
        content_hash: artifact.content_hash,
      },
    }),
  );
  await appendAudit(client, deps.ctx, {
    action: 'TENANT_SERVICE_BINDING_PUBLISH',
    actionClass: 'WRITE',
    resourceType: 'TenantServiceBinding',
    resourceId: row.binding_id,
    result: 'SUCCESS',
    now: deps.now,
  });
  return bindingPublic(row, approved.simulation);
}

export async function readArtifact(client: PoolClient, ctx: RequestContext, versionId: string) {
  const row = await getArtifact(client, tenantOf(ctx), versionId);
  if (!row) throw new Cmp052Error('SF-APP-001', { statusCode: 404 });
  return artifactPublic(row);
}
