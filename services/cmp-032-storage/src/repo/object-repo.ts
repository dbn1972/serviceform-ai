import type { SimulationMarker } from '@serviceform/contracts';
import type { PoolClient } from 'pg';

export interface ObjectMetadataRow {
  object_id: string;
  tenant_id: string;
  cell_id: string;
  object_key: string;
  content_type: string;
  byte_size: string;
  checksum_sha256: string;
  encryption_algorithm: string;
  kms_key_ref: string;
  wrapped_dek: string;
  kms_key_version: string;
  encryption_context: Record<string, unknown>;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  storage_mode: 'SIMULATED' | 'LOCAL';
  environment: string;
  simulation: SimulationMarker | null;
  policy_id: string;
  aggregate_version: string;
  created_by: string;
  created_at: Date;
  archived_at: Date | null;
  deleted_at: Date | null;
}

export async function insertObjectMetadata(
  client: PoolClient,
  row: {
    objectId: string;
    tenantId: string;
    cellId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    kmsKeyRef: string;
    wrappedDek: string;
    kmsKeyVersion: string;
    encryptionContext: Record<string, string>;
    storageMode: 'SIMULATED' | 'LOCAL';
    environment: string;
    simulation: SimulationMarker | null;
    policyId: string;
    createdBy: string;
  },
): Promise<ObjectMetadataRow> {
  const result = await client.query<ObjectMetadataRow>(
    `INSERT INTO sf_storage.object_metadata (
       object_id, tenant_id, cell_id, object_key, content_type, byte_size, checksum_sha256,
       encryption_algorithm, kms_key_ref, wrapped_dek, kms_key_version, encryption_context,
       status, storage_mode, environment, simulation, policy_id, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'AES_256_GCM',$8,$9,$10,$11::jsonb,'ACTIVE',$12,$13,$14::jsonb,$15,$16
     )
     RETURNING *`,
    [
      row.objectId,
      row.tenantId,
      row.cellId,
      row.objectKey,
      row.contentType,
      row.byteSize,
      row.checksumSha256,
      row.kmsKeyRef,
      row.wrappedDek,
      row.kmsKeyVersion,
      JSON.stringify(row.encryptionContext),
      row.storageMode,
      row.environment,
      row.simulation ? JSON.stringify(row.simulation) : null,
      row.policyId,
      row.createdBy,
    ],
  );
  const inserted = result.rows[0];
  if (!inserted) throw new Error('object_metadata insert returned no row');
  return inserted;
}

export async function getObjectMetadata(
  client: PoolClient,
  objectId: string,
): Promise<ObjectMetadataRow | null> {
  const result = await client.query<ObjectMetadataRow>(
    `SELECT * FROM sf_storage.object_metadata WHERE object_id = $1`,
    [objectId],
  );
  return result.rows[0] ?? null;
}

export async function archiveObjectMetadata(
  client: PoolClient,
  objectId: string,
  now: Date,
): Promise<ObjectMetadataRow | null> {
  const result = await client.query<ObjectMetadataRow>(
    `UPDATE sf_storage.object_metadata
        SET status = 'ARCHIVED',
            archived_at = $2,
            aggregate_version = aggregate_version + 1
      WHERE object_id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [objectId, now.toISOString()],
  );
  return result.rows[0] ?? null;
}
