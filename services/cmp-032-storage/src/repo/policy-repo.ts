import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export interface StoragePolicyRow {
  policy_id: string;
  tenant_id: string;
  encryption_algorithm: string;
  kms_key_ref: string;
  max_object_bytes: string;
  allowed_content_types: string[];
  retention_class: string;
  status: string;
  version: string;
}

export async function ensureActivePolicy(
  client: PoolClient,
  tenantId: string,
  kmsKeyRef: string,
): Promise<StoragePolicyRow> {
  const existing = await client.query<StoragePolicyRow>(
    `SELECT policy_id, tenant_id, encryption_algorithm, kms_key_ref, max_object_bytes::text,
            allowed_content_types, retention_class, status, version::text
       FROM sf_storage.storage_policy
      WHERE tenant_id = $1 AND status = 'ACTIVE'
      LIMIT 1`,
    [tenantId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const policyId = randomUUID();
  const inserted = await client.query<StoragePolicyRow>(
    `INSERT INTO sf_storage.storage_policy (
       policy_id, tenant_id, encryption_algorithm, kms_key_ref, max_object_bytes,
       allowed_content_types, retention_class, status
     ) VALUES ($1,$2,'AES_256_GCM',$3,10485760, ARRAY['application/octet-stream','application/pdf','image/png','image/jpeg'],'STANDARD','ACTIVE')
     RETURNING policy_id, tenant_id, encryption_algorithm, kms_key_ref, max_object_bytes::text,
               allowed_content_types, retention_class, status, version::text`,
    [policyId, tenantId, kmsKeyRef],
  );
  return inserted.rows[0]!;
}
