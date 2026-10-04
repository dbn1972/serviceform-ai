import type { PoolClient } from 'pg';

export interface BundleRow {
  bundle_id: string;
  tenant_id: string;
  cell_id: string;
  bundle_key: string;
  composition_hash: string;
  document_ids: string[];
  missing_kinds: string[];
  status: 'COMPOSED' | 'PUBLISHED';
  aggregate_version: string;
  created_by: string;
  created_at: Date;
  published_at: Date | null;
}

export async function insertBundle(
  client: PoolClient,
  row: {
    bundleId: string;
    tenantId: string;
    cellId: string;
    bundleKey: string;
    compositionHash: string;
    documentIds: string[];
    missingKinds: string[];
    createdBy: string;
    now: Date;
  },
): Promise<BundleRow> {
  const res = await client.query<BundleRow>(
    `INSERT INTO sf_metadata.metadata_bundle (
       bundle_id, tenant_id, cell_id, bundle_key, composition_hash, document_ids, missing_kinds,
       status, aggregate_version, created_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7::text[],'COMPOSED',1,$8,$9)
     RETURNING *`,
    [
      row.bundleId,
      row.tenantId,
      row.cellId,
      row.bundleKey,
      row.compositionHash,
      row.documentIds,
      row.missingKinds,
      row.createdBy,
      row.now.toISOString(),
    ],
  );
  return res.rows[0] as BundleRow;
}
