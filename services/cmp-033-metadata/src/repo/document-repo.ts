import type { PoolClient } from 'pg';
import type { MetadataKind } from '../domain/kinds.js';

export interface DocumentRow {
  document_id: string;
  tenant_id: string;
  cell_id: string;
  document_key: string;
  kind: MetadataKind;
  schema_id: string;
  payload: unknown;
  payload_hash: string;
  status: 'DRAFT' | 'VALIDATED' | 'COMPOSED' | 'PUBLISHED';
  aggregate_version: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  validated_at: Date | null;
  published_at: Date | null;
}

export async function insertDocument(
  client: PoolClient,
  row: {
    documentId: string;
    tenantId: string;
    cellId: string;
    documentKey: string;
    kind: MetadataKind;
    schemaId: string;
    payload: unknown;
    payloadHash: string;
    createdBy: string;
    now: Date;
  },
): Promise<DocumentRow> {
  const res = await client.query<DocumentRow>(
    `INSERT INTO sf_metadata.metadata_document (
       document_id, tenant_id, cell_id, document_key, kind, schema_id, payload, payload_hash,
       status, aggregate_version, created_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'DRAFT',1,$9,$10,$10)
     RETURNING *`,
    [
      row.documentId,
      row.tenantId,
      row.cellId,
      row.documentKey,
      row.kind,
      row.schemaId,
      JSON.stringify(row.payload),
      row.payloadHash,
      row.createdBy,
      row.now.toISOString(),
    ],
  );
  return res.rows[0] as DocumentRow;
}

export async function getDocument(
  client: PoolClient,
  tenantId: string,
  documentId: string,
): Promise<DocumentRow | undefined> {
  const res = await client.query<DocumentRow>(
    `SELECT * FROM sf_metadata.metadata_document WHERE tenant_id = $1 AND document_id = $2`,
    [tenantId, documentId],
  );
  return res.rows[0];
}

export async function updateDocumentPayload(
  client: PoolClient,
  params: {
    tenantId: string;
    documentId: string;
    payload: unknown;
    payloadHash: string;
    schemaId: string;
    now: Date;
  },
): Promise<DocumentRow | undefined> {
  const res = await client.query<DocumentRow>(
    `UPDATE sf_metadata.metadata_document
        SET payload = $1::jsonb,
            payload_hash = $2,
            schema_id = $3,
            status = 'DRAFT',
            validated_at = NULL,
            aggregate_version = aggregate_version + 1,
            updated_at = $4
      WHERE tenant_id = $5 AND document_id = $6
      RETURNING *`,
    [
      JSON.stringify(params.payload),
      params.payloadHash,
      params.schemaId,
      params.now.toISOString(),
      params.tenantId,
      params.documentId,
    ],
  );
  return res.rows[0];
}

export async function markValidated(
  client: PoolClient,
  params: { tenantId: string; documentId: string; now: Date },
): Promise<DocumentRow | undefined> {
  const res = await client.query<DocumentRow>(
    `UPDATE sf_metadata.metadata_document
        SET status = 'VALIDATED',
            validated_at = $1,
            aggregate_version = aggregate_version + 1,
            updated_at = $1
      WHERE tenant_id = $2 AND document_id = $3
      RETURNING *`,
    [params.now.toISOString(), params.tenantId, params.documentId],
  );
  return res.rows[0];
}

export async function markPublished(
  client: PoolClient,
  params: { tenantId: string; documentId: string; now: Date },
): Promise<DocumentRow | undefined> {
  const res = await client.query<DocumentRow>(
    `UPDATE sf_metadata.metadata_document
        SET status = 'PUBLISHED',
            published_at = $1,
            aggregate_version = aggregate_version + 1,
            updated_at = $1
      WHERE tenant_id = $2 AND document_id = $3
      RETURNING *`,
    [params.now.toISOString(), params.tenantId, params.documentId],
  );
  return res.rows[0];
}

export async function markComposed(
  client: PoolClient,
  params: { tenantId: string; documentIds: string[]; now: Date },
): Promise<void> {
  await client.query(
    `UPDATE sf_metadata.metadata_document
        SET status = CASE WHEN status = 'PUBLISHED' THEN status ELSE 'COMPOSED' END,
            aggregate_version = aggregate_version + 1,
            updated_at = $1
      WHERE tenant_id = $2 AND document_id = ANY($3::uuid[])`,
    [params.now.toISOString(), params.tenantId, params.documentIds],
  );
}

export async function listDocumentsByIds(
  client: PoolClient,
  tenantId: string,
  ids: string[],
): Promise<DocumentRow[]> {
  const res = await client.query<DocumentRow>(
    `SELECT * FROM sf_metadata.metadata_document
      WHERE tenant_id = $1 AND document_id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  return res.rows;
}
