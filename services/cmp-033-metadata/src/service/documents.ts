import { randomUUID } from 'node:crypto';
import type { RequestContext, SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import {
  isDocumentKey,
  isMetadataKind,
  payloadHash,
  schemaIdForKind,
  sha256Fingerprint,
  METADATA_KINDS,
} from '../domain/kinds.js';
import { Cmp033Error, mapPgError } from '../errors.js';
import type { SchemaRegistryPort } from '../ports/schema-registry.js';
import {
  getDocument,
  insertDocument,
  markComposed,
  markPublished,
  markValidated,
  updateDocumentPayload,
  listDocumentsByIds,
  type DocumentRow,
} from '../repo/document-repo.js';
import { insertBundle } from '../repo/bundle-repo.js';

export function documentPublic(row: DocumentRow, simulation?: SimulationMarker) {
  const body: Record<string, unknown> = {
    document_id: row.document_id,
    document_key: row.document_key,
    kind: row.kind,
    schema_id: row.schema_id,
    payload: row.payload,
    payload_hash: row.payload_hash,
    status: row.status,
    aggregate_version: Number(row.aggregate_version),
  };
  if (simulation) body['simulation'] = simulation;
  return body;
}

function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenant_id) throw new Cmp033Error('SF-TEN-001');
  return ctx.tenant_id;
}

export async function createDocument(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  input: { kind: string; document_key: string; payload: unknown; schema_id?: string },
) {
  const tenantId = tenantOf(deps.ctx);
  if (!isMetadataKind(input.kind)) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'UNKNOWN_KIND' }] });
  }
  if (!isDocumentKey(input.document_key)) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'INVALID_DOCUMENT_KEY' }] });
  }
  const schemaId = input.schema_id ?? schemaIdForKind(input.kind);
  if (schemaId !== schemaIdForKind(input.kind)) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'SCHEMA_ID_MISMATCH' }] });
  }
  const documentId = randomUUID();
  let row: DocumentRow;
  try {
    row = await insertDocument(client, {
      documentId,
      tenantId,
      cellId: deps.ctx.cell_id,
      documentKey: input.document_key,
      kind: input.kind,
      schemaId,
      payload: input.payload,
      payloadHash: payloadHash(input.payload),
      createdBy: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  const envelope = envelopeOf({
    eventType: 'MetadataDocumentCreated',
    tenantId,
    cellId: deps.ctx.cell_id,
    aggregateType: 'MetadataDocument',
    aggregateId: row.document_id,
    aggregateVersion: Number(row.aggregate_version),
    occurredAt: deps.now.toISOString(),
    correlationId: deps.ctx.correlation_id,
    actor: deps.ctx.actor,
    data: {
      document_id: row.document_id,
      kind: row.kind,
      document_key: row.document_key,
      status: row.status,
    },
  });
  await insertOutbox(client, envelope);
  return documentPublic(row);
}

export async function readDocument(client: PoolClient, ctx: RequestContext, documentId: string) {
  const tenantId = tenantOf(ctx);
  const row = await getDocument(client, tenantId, documentId);
  if (!row) throw new Cmp033Error('SF-APP-001', { statusCode: 404 });
  return documentPublic(row);
}

export async function patchDocument(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  documentId: string,
  payload: unknown,
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getDocument(client, tenantId, documentId);
  if (!existing) throw new Cmp033Error('SF-APP-001', { statusCode: 404 });
  if (existing.status === 'PUBLISHED') {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  let row: DocumentRow | undefined;
  try {
    row = await updateDocumentPayload(client, {
      tenantId,
      documentId,
      payload,
      payloadHash: payloadHash(payload),
      schemaId: existing.schema_id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp033Error('SF-APP-001', { statusCode: 404 });
  await insertOutbox(
    client,
    envelopeOf({
      eventType: 'MetadataDocumentUpdated',
      tenantId,
      cellId: deps.ctx.cell_id,
      aggregateType: 'MetadataDocument',
      aggregateId: row.document_id,
      aggregateVersion: Number(row.aggregate_version),
      occurredAt: deps.now.toISOString(),
      correlationId: deps.ctx.correlation_id,
      actor: deps.ctx.actor,
      data: {
        document_id: row.document_id,
        kind: row.kind,
        status: row.status,
      },
    }),
  );
  return documentPublic(row);
}

export async function validateDocument(
  client: PoolClient,
  deps: {
    ctx: RequestContext;
    now: Date;
    registry: SchemaRegistryPort;
  },
  documentId: string,
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getDocument(client, tenantId, documentId);
  if (!existing) throw new Cmp033Error('SF-APP-001', { statusCode: 404 });
  if (existing.status === 'PUBLISHED') {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  const checked = await deps.registry.validate({
    kind: existing.kind,
    schemaId: existing.schema_id,
    payload: existing.payload,
  });
  let row: DocumentRow | undefined;
  try {
    row = await markValidated(client, { tenantId, documentId, now: deps.now });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp033Error('SF-APP-001', { statusCode: 404 });
  await insertOutbox(
    client,
    envelopeOf({
      eventType: 'MetadataDocumentValidated',
      tenantId,
      cellId: deps.ctx.cell_id,
      aggregateType: 'MetadataDocument',
      aggregateId: row.document_id,
      aggregateVersion: Number(row.aggregate_version),
      occurredAt: deps.now.toISOString(),
      correlationId: deps.ctx.correlation_id,
      actor: deps.ctx.actor,
      data: {
        document_id: row.document_id,
        kind: row.kind,
        schema_id: row.schema_id,
        status: row.status,
      },
    }),
  );
  return documentPublic(row, checked.simulation);
}

export async function publishDocument(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  documentId: string,
) {
  const tenantId = tenantOf(deps.ctx);
  const existing = await getDocument(client, tenantId, documentId);
  if (!existing) throw new Cmp033Error('SF-APP-001', { statusCode: 404 });
  if (existing.status === 'PUBLISHED') {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  if (existing.status !== 'VALIDATED' && existing.status !== 'COMPOSED') {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'NOT_VALIDATED' }] });
  }
  let row: DocumentRow | undefined;
  try {
    row = await markPublished(client, { tenantId, documentId, now: deps.now });
  } catch (err) {
    throw mapPgError(err);
  }
  if (!row) throw new Cmp033Error('SF-APP-001', { statusCode: 404 });
  await insertOutbox(
    client,
    envelopeOf({
      eventType: 'MetadataDocumentPublished',
      tenantId,
      cellId: deps.ctx.cell_id,
      aggregateType: 'MetadataDocument',
      aggregateId: row.document_id,
      aggregateVersion: Number(row.aggregate_version),
      occurredAt: deps.now.toISOString(),
      correlationId: deps.ctx.correlation_id,
      actor: deps.ctx.actor,
      data: {
        document_id: row.document_id,
        kind: row.kind,
        status: row.status,
      },
    }),
  );
  return documentPublic(row);
}

export async function composeBundle(
  client: PoolClient,
  deps: { ctx: RequestContext; now: Date },
  input: { bundle_key: string; document_ids: string[] },
) {
  const tenantId = tenantOf(deps.ctx);
  if (!isDocumentKey(input.bundle_key)) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'INVALID_BUNDLE_KEY' }] });
  }
  if (!Array.isArray(input.document_ids) || input.document_ids.length < 1) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'DOCUMENT_IDS_REQUIRED' }] });
  }
  const unique = [...new Set(input.document_ids)];
  const rows = await listDocumentsByIds(client, tenantId, unique);
  if (rows.length !== unique.length) {
    throw new Cmp033Error('SF-APP-001', {
      statusCode: 404,
      details: [{ code: 'DOCUMENT_NOT_FOUND' }],
    });
  }
  const notReady = rows.filter(
    (r) => r.status !== 'VALIDATED' && r.status !== 'COMPOSED' && r.status !== 'PUBLISHED',
  );
  if (notReady.length > 0) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'DOCUMENTS_NOT_VALIDATED' }] });
  }
  const present = new Set(rows.map((r) => r.kind));
  const missing = METADATA_KINDS.filter((k) => !present.has(k));
  const compositionHash = sha256Fingerprint(
    rows.map((r) => `${r.kind}:${r.document_id}:${r.payload_hash}:${r.aggregate_version}`).sort(),
  );
  const bundleId = randomUUID();
  const mutableIds = rows.filter((r) => r.status !== 'PUBLISHED').map((r) => r.document_id);
  if (mutableIds.length > 0) {
    await markComposed(client, { tenantId, documentIds: mutableIds, now: deps.now });
  }
  let bundle;
  try {
    bundle = await insertBundle(client, {
      bundleId,
      tenantId,
      cellId: deps.ctx.cell_id,
      bundleKey: input.bundle_key,
      compositionHash,
      documentIds: unique,
      missingKinds: missing as unknown as string[],
      createdBy: deps.ctx.actor.id,
      now: deps.now,
    });
  } catch (err) {
    throw mapPgError(err);
  }
  await insertOutbox(
    client,
    envelopeOf({
      eventType: 'MetadataBundleComposed',
      tenantId,
      cellId: deps.ctx.cell_id,
      aggregateType: 'MetadataBundle',
      aggregateId: bundle.bundle_id,
      aggregateVersion: Number(bundle.aggregate_version),
      occurredAt: deps.now.toISOString(),
      correlationId: deps.ctx.correlation_id,
      actor: deps.ctx.actor,
      data: {
        bundle_id: bundle.bundle_id,
        bundle_key: bundle.bundle_key,
        composition_hash: bundle.composition_hash,
        document_ids: bundle.document_ids,
        missing_kinds: bundle.missing_kinds,
      },
    }),
  );
  return {
    bundle_id: bundle.bundle_id,
    bundle_key: bundle.bundle_key,
    composition_hash: bundle.composition_hash,
    document_ids: bundle.document_ids,
    missing_kinds: bundle.missing_kinds,
    status: bundle.status,
    aggregate_version: Number(bundle.aggregate_version),
  };
}
