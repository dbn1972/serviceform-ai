import type { RequestContext } from '@serviceform/contracts';
import {
  assertChecksum,
  buildObjectKey,
  buildStorageSimulationMarker,
  newObjectId,
  sha256Hex,
  type ObjectStorePort,
  type StorageKmsPort,
  type StorageMode,
} from '@serviceform/storage';
import type { PoolClient } from 'pg';
import type { StorageServiceConfig } from '../config.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { Cmp032Error } from '../errors.js';
import { wrapContentDek } from '../ports/kms-port.js';
import { insertObjectMetadata } from '../repo/object-repo.js';
import { ensureActivePolicy } from '../repo/policy-repo.js';

export interface StoreObjectInput {
  contentType: string;
  contentBase64: string;
  checksumSha256?: string;
}

export async function storeObject(
  client: PoolClient,
  deps: {
    ctx: RequestContext;
    config: StorageServiceConfig;
    store: ObjectStorePort;
    kms: StorageKmsPort;
    now: Date;
  },
  input: StoreObjectInput,
): Promise<{
  object_id: string;
  object_key: string;
  checksum_sha256: string;
  byte_size: number;
  status: string;
  storage_mode: StorageMode;
  simulation?: ReturnType<typeof buildStorageSimulationMarker>;
}> {
  const tenantId = deps.ctx.tenant_id;
  if (!tenantId) throw new Cmp032Error('SF-TEN-001');

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.contentBase64, 'base64');
  } catch {
    throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'CONTENT_BASE64_INVALID' }] });
  }
  if (bytes.byteLength === 0) {
    throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'EMPTY_CONTENT' }] });
  }

  const checksum = sha256Hex(bytes);
  if (input.checksumSha256 && input.checksumSha256.toLowerCase() !== checksum) {
    throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'CHECKSUM_MISMATCH' }] });
  }
  try {
    assertChecksum(bytes, checksum);
  } catch {
    throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'CHECKSUM_MISMATCH' }] });
  }

  const policy = await ensureActivePolicy(client, tenantId, deps.config.kmsKeyRef);
  if (bytes.byteLength > Number(policy.max_object_bytes)) {
    throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'OBJECT_TOO_LARGE' }] });
  }
  if (!policy.allowed_content_types.includes(input.contentType)) {
    throw new Cmp032Error('SF-SYS-003', { details: [{ code: 'CONTENT_TYPE_FORBIDDEN' }] });
  }

  const objectId = newObjectId();
  const objectKey = buildObjectKey({
    tenantId,
    cellId: deps.ctx.cell_id,
    objectId,
    contentSha256: checksum,
  });
  const encContext = {
    tenant_id: tenantId,
    cell_id: deps.ctx.cell_id,
    object_id: objectId,
  };
  const wrapped = await wrapContentDek(deps.kms, deps.config.kmsKeyRef, encContext);
  wrapped.dek.fill(0);

  const simulation =
    deps.config.storageMode === 'SIMULATED'
      ? buildStorageSimulationMarker({
          environment: deps.config.environment,
          scenario: deps.config.scenario,
          testRunId: deps.config.testRunId,
          storageBindingId: deps.config.storageBindingId,
        })
      : null;

  // Object bytes outside the DB transaction (no network-in-txn for REAL; SIMULATED is local).
  // Metadata + outbox commit after durable-enough put for SIMULATED mode.
  await deps.store.put({
    objectId,
    objectKey,
    contentType: input.contentType,
    bytes,
    checksumSha256: checksum,
    mode: deps.config.storageMode,
    ...(simulation ? { simulation } : {}),
  });

  const row = await insertObjectMetadata(client, {
    objectId,
    tenantId,
    cellId: deps.ctx.cell_id,
    objectKey,
    contentType: input.contentType,
    byteSize: bytes.byteLength,
    checksumSha256: checksum,
    kmsKeyRef: deps.config.kmsKeyRef,
    wrappedDek: wrapped.wrappedDek,
    kmsKeyVersion: wrapped.keyVersion,
    encryptionContext: encContext,
    storageMode: deps.config.storageMode,
    environment: deps.config.environment,
    simulation,
    policyId: policy.policy_id,
    createdBy: deps.ctx.actor.id,
  });

  const event = envelopeOf({
    eventType: 'ObjectStored',
    tenantId,
    cellId: deps.ctx.cell_id,
    aggregateType: 'StorageObject',
    aggregateId: objectId,
    aggregateVersion: Number(row.aggregate_version),
    occurredAt: deps.now.toISOString(),
    correlationId: deps.ctx.correlation_id,
    actor: deps.ctx.actor,
    data: {
      object_id: objectId,
      object_key: objectKey,
      checksum_sha256: checksum,
      byte_size: bytes.byteLength,
      storage_mode: deps.config.storageMode,
      ...(simulation ? { simulation } : {}),
    },
  });
  await insertOutbox(client, event);

  return {
    object_id: objectId,
    object_key: objectKey,
    checksum_sha256: checksum,
    byte_size: bytes.byteLength,
    status: 'ACTIVE',
    storage_mode: deps.config.storageMode,
    ...(simulation ? { simulation } : {}),
  };
}
