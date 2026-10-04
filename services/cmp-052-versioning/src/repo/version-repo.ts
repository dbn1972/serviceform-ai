import type { PoolClient } from 'pg';
import type { PinMap } from '../domain/pins.js';

export type BindingStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';

export interface BindingRow {
  binding_id: string;
  tenant_id: string;
  cell_id: string;
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  pins: PinMap;
  dependency_graph: unknown;
  artifact_hash: string;
  status: BindingStatus;
  published_version_id: string | null;
  aggregate_version: string | number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

export interface ArtifactRow {
  version_id: string;
  tenant_id: string;
  cell_id: string;
  artifact_kind: 'TENANT_SERVICE_BINDING';
  artifact_key: string;
  version_no: string | number;
  content_hash: string;
  dependency_graph: unknown;
  source_binding_id: string;
  status: 'PUBLISHED';
  created_by: string;
  created_at: Date;
  published_at: Date;
}

export async function insertBinding(
  client: PoolClient,
  row: {
    bindingId: string;
    tenantId: string;
    cellId: string;
    bindingKey: string;
    offeringRef: string;
    metadataBundleRef: string;
    pins: PinMap;
    dependencyGraph: unknown;
    artifactHash: string;
    createdBy: string;
    now: Date;
  },
): Promise<BindingRow> {
  const res = await client.query<BindingRow>(
    `INSERT INTO sf_versioning.tenant_service_binding (
       binding_id, tenant_id, cell_id, binding_key, offering_ref, metadata_bundle_ref,
       pins, dependency_graph, artifact_hash, status, created_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'DRAFT',$10,$11,$11)
     RETURNING *`,
    [
      row.bindingId,
      row.tenantId,
      row.cellId,
      row.bindingKey,
      row.offeringRef,
      row.metadataBundleRef,
      JSON.stringify(row.pins),
      JSON.stringify(row.dependencyGraph),
      row.artifactHash,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as BindingRow;
}

export async function getBinding(
  client: PoolClient,
  tenantId: string,
  bindingId: string,
): Promise<BindingRow | undefined> {
  const res = await client.query<BindingRow>(
    `SELECT * FROM sf_versioning.tenant_service_binding WHERE tenant_id = $1 AND binding_id = $2`,
    [tenantId, bindingId],
  );
  return res.rows[0];
}

export async function updateDraftBinding(
  client: PoolClient,
  params: {
    tenantId: string;
    bindingId: string;
    offeringRef: string;
    metadataBundleRef: string;
    pins: PinMap;
    dependencyGraph: unknown;
    artifactHash: string;
    now: Date;
  },
): Promise<BindingRow | undefined> {
  const res = await client.query<BindingRow>(
    `UPDATE sf_versioning.tenant_service_binding
        SET offering_ref = $1,
            metadata_bundle_ref = $2,
            pins = $3::jsonb,
            dependency_graph = $4::jsonb,
            artifact_hash = $5,
            updated_at = $6,
            aggregate_version = aggregate_version + 1
      WHERE tenant_id = $7 AND binding_id = $8 AND status = 'DRAFT'
      RETURNING *`,
    [
      params.offeringRef,
      params.metadataBundleRef,
      JSON.stringify(params.pins),
      JSON.stringify(params.dependencyGraph),
      params.artifactHash,
      params.now,
      params.tenantId,
      params.bindingId,
    ],
  );
  return res.rows[0];
}

export async function nextVersionNo(
  client: PoolClient,
  tenantId: string,
  artifactKey: string,
): Promise<number> {
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(version_no), 0)::text AS n
       FROM sf_versioning.artifact_version
      WHERE tenant_id = $1 AND artifact_kind = 'TENANT_SERVICE_BINDING' AND artifact_key = $2`,
    [tenantId, artifactKey],
  );
  return Number(res.rows[0]?.n ?? 0) + 1;
}

export async function insertArtifact(
  client: PoolClient,
  row: {
    versionId: string;
    tenantId: string;
    cellId: string;
    artifactKey: string;
    versionNo: number;
    contentHash: string;
    dependencyGraph: unknown;
    sourceBindingId: string;
    createdBy: string;
    now: Date;
  },
): Promise<ArtifactRow> {
  const res = await client.query<ArtifactRow>(
    `INSERT INTO sf_versioning.artifact_version (
       version_id, tenant_id, cell_id, artifact_kind, artifact_key, version_no,
       content_hash, dependency_graph, source_binding_id, status, created_by, created_at, published_at
     ) VALUES ($1,$2,$3,'TENANT_SERVICE_BINDING',$4,$5,$6,$7::jsonb,$8,'PUBLISHED',$9,$10,$10)
     RETURNING *`,
    [
      row.versionId,
      row.tenantId,
      row.cellId,
      row.artifactKey,
      row.versionNo,
      row.contentHash,
      JSON.stringify(row.dependencyGraph),
      row.sourceBindingId,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as ArtifactRow;
}

export async function markBindingPublished(
  client: PoolClient,
  params: {
    tenantId: string;
    bindingId: string;
    versionId: string;
    now: Date;
  },
): Promise<BindingRow | undefined> {
  const res = await client.query<BindingRow>(
    `UPDATE sf_versioning.tenant_service_binding
        SET status = 'PUBLISHED',
            published_version_id = $1,
            published_at = $2,
            updated_at = $2,
            aggregate_version = aggregate_version + 1
      WHERE tenant_id = $3 AND binding_id = $4 AND status = 'DRAFT'
      RETURNING *`,
    [params.versionId, params.now, params.tenantId, params.bindingId],
  );
  return res.rows[0];
}

export async function getArtifact(
  client: PoolClient,
  tenantId: string,
  versionId: string,
): Promise<ArtifactRow | undefined> {
  const res = await client.query<ArtifactRow>(
    `SELECT * FROM sf_versioning.artifact_version WHERE tenant_id = $1 AND version_id = $2`,
    [tenantId, versionId],
  );
  return res.rows[0];
}
