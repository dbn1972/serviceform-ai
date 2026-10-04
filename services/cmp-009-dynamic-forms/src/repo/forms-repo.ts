import type { PoolClient } from 'pg';

export type ResultCode = 'VALID' | 'INVALID';

export interface SnapshotRow {
  snapshot_id: string;
  tenant_id: string;
  cell_id: string;
  form_key: string;
  content_hash: string;
  payload_digest: string;
  payload: unknown;
  created_by: string;
  created_at: Date;
}

export interface ExecutionRow {
  execution_id: string;
  tenant_id: string;
  cell_id: string;
  snapshot_id: string;
  form_key: string;
  version_id: string;
  content_hash: string;
  data_hash: string;
  purpose_code: string;
  locale: string;
  result_code: ResultCode;
  visible_fields: string[];
  required_fields: string[];
  errors: { code: string; pointer: string }[];
  renderer_ids: string[];
  requested_by: string;
  evaluated_at: Date;
}

export async function ensureSnapshot(
  client: PoolClient,
  row: {
    snapshotId: string;
    tenantId: string;
    cellId: string;
    formKey: string;
    contentHash: string;
    payloadDigest: string;
    payload: unknown;
    createdBy: string;
    now: Date;
  },
): Promise<SnapshotRow> {
  await client.query(
    `INSERT INTO sf_forms.form_definition_snapshot (
       snapshot_id, tenant_id, cell_id, form_key, content_hash, payload_digest, payload,
       created_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     ON CONFLICT (tenant_id, form_key, content_hash) DO NOTHING`,
    [
      row.snapshotId,
      row.tenantId,
      row.cellId,
      row.formKey,
      row.contentHash,
      row.payloadDigest,
      JSON.stringify(row.payload),
      row.createdBy,
      row.now,
    ],
  );
  const res = await client.query<SnapshotRow>(
    `SELECT * FROM sf_forms.form_definition_snapshot
      WHERE tenant_id = $1 AND form_key = $2 AND content_hash = $3`,
    [row.tenantId, row.formKey, row.contentHash],
  );
  return res.rows[0] as SnapshotRow;
}

export async function insertExecution(
  client: PoolClient,
  row: {
    executionId: string;
    tenantId: string;
    cellId: string;
    snapshotId: string;
    formKey: string;
    versionId: string;
    contentHash: string;
    dataHash: string;
    purposeCode: string;
    locale: string;
    resultCode: ResultCode;
    visibleFields: string[];
    requiredFields: string[];
    errors: { code: string; pointer: string }[];
    rendererIds: string[];
    requestedBy: string;
    now: Date;
  },
): Promise<ExecutionRow> {
  const res = await client.query<ExecutionRow>(
    `INSERT INTO sf_forms.form_execution_record (
       execution_id, tenant_id, cell_id, snapshot_id, form_key, version_id, content_hash,
       data_hash, purpose_code, locale, result_code, visible_fields, required_fields, errors,
       renderer_ids, requested_by, evaluated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17)
     RETURNING *`,
    [
      row.executionId,
      row.tenantId,
      row.cellId,
      row.snapshotId,
      row.formKey,
      row.versionId,
      row.contentHash,
      row.dataHash,
      row.purposeCode,
      row.locale,
      row.resultCode,
      JSON.stringify(row.visibleFields),
      JSON.stringify(row.requiredFields),
      JSON.stringify(row.errors),
      JSON.stringify(row.rendererIds),
      row.requestedBy,
      row.now,
    ],
  );
  return res.rows[0] as ExecutionRow;
}

export async function getExecution(
  client: PoolClient,
  tenantId: string,
  executionId: string,
): Promise<ExecutionRow | undefined> {
  const res = await client.query<ExecutionRow>(
    `SELECT * FROM sf_forms.form_execution_record WHERE tenant_id = $1 AND execution_id = $2`,
    [tenantId, executionId],
  );
  return res.rows[0];
}
