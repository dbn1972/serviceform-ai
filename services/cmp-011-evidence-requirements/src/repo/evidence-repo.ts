import type { PoolClient } from 'pg';

export type PolicyStatus = 'DRAFT' | 'PUBLISHED';

export interface PolicyRow {
  policy_id: string;
  tenant_id: string;
  cell_id: string;
  policy_key: string;
  status: PolicyStatus;
  version_no: string | number | null;
  version_ref: string | null;
  definition: unknown;
  content_hash: string;
  aggregate_version: string | number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

export interface ResolutionRow {
  resolution_id: string;
  tenant_id: string;
  cell_id: string;
  binding_id: string;
  policy_id: string;
  version_ref: string;
  policy_content_hash: string;
  application_ref: string | null;
  input_hash: string;
  decision_hash: string;
  checklist: unknown;
  decision_trace: unknown;
  simulated: boolean;
  created_by: string;
  created_at: Date;
}

export async function insertPolicy(
  client: PoolClient,
  row: {
    policyId: string;
    tenantId: string;
    cellId: string;
    policyKey: string;
    definition: unknown;
    contentHash: string;
    createdBy: string;
    now: Date;
  },
): Promise<PolicyRow> {
  const res = await client.query<PolicyRow>(
    `INSERT INTO sf_evidence.evidence_policy (
       policy_id, tenant_id, cell_id, policy_key, status, definition, content_hash, created_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,'DRAFT',$5::jsonb,$6,$7,$8,$8)
     RETURNING *`,
    [
      row.policyId,
      row.tenantId,
      row.cellId,
      row.policyKey,
      JSON.stringify(row.definition),
      row.contentHash,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as PolicyRow;
}

export async function getPolicy(
  client: PoolClient,
  tenantId: string,
  policyId: string,
): Promise<PolicyRow | undefined> {
  const res = await client.query<PolicyRow>(
    `SELECT * FROM sf_evidence.evidence_policy WHERE tenant_id = $1 AND policy_id = $2`,
    [tenantId, policyId],
  );
  return res.rows[0];
}

export async function getPublishedPolicyByVersionRef(
  client: PoolClient,
  tenantId: string,
  versionRef: string,
): Promise<PolicyRow | undefined> {
  const res = await client.query<PolicyRow>(
    `SELECT * FROM sf_evidence.evidence_policy
      WHERE tenant_id = $1 AND version_ref = $2 AND status = 'PUBLISHED'`,
    [tenantId, versionRef],
  );
  return res.rows[0];
}

export async function updateDraftPolicy(
  client: PoolClient,
  row: { tenantId: string; policyId: string; definition: unknown; contentHash: string; now: Date },
): Promise<PolicyRow | undefined> {
  const res = await client.query<PolicyRow>(
    `UPDATE sf_evidence.evidence_policy
        SET definition = $1::jsonb, content_hash = $2, updated_at = $3, aggregate_version = aggregate_version + 1
      WHERE tenant_id = $4 AND policy_id = $5 AND status = 'DRAFT'
      RETURNING *`,
    [JSON.stringify(row.definition), row.contentHash, row.now, row.tenantId, row.policyId],
  );
  return res.rows[0];
}

export async function nextVersionNo(
  client: PoolClient,
  tenantId: string,
  policyKey: string,
): Promise<number> {
  const res = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS n
       FROM sf_evidence.evidence_policy
      WHERE tenant_id = $1 AND policy_key = $2 AND status = 'PUBLISHED'`,
    [tenantId, policyKey],
  );
  return Number(res.rows[0]?.n ?? 1);
}

export async function markPolicyPublished(
  client: PoolClient,
  row: { tenantId: string; policyId: string; versionNo: number; versionRef: string; now: Date },
): Promise<PolicyRow | undefined> {
  const res = await client.query<PolicyRow>(
    `UPDATE sf_evidence.evidence_policy
        SET status = 'PUBLISHED', version_no = $1, version_ref = $2, published_at = $3, updated_at = $3,
            aggregate_version = aggregate_version + 1
      WHERE tenant_id = $4 AND policy_id = $5 AND status = 'DRAFT'
      RETURNING *`,
    [row.versionNo, row.versionRef, row.now, row.tenantId, row.policyId],
  );
  return res.rows[0];
}

export async function insertResolution(
  client: PoolClient,
  row: {
    resolutionId: string;
    tenantId: string;
    cellId: string;
    bindingId: string;
    policyId: string;
    versionRef: string;
    policyContentHash: string;
    applicationRef: string | null;
    inputHash: string;
    decisionHash: string;
    checklist: unknown;
    trace: unknown;
    simulated: boolean;
    createdBy: string;
    now: Date;
  },
): Promise<ResolutionRow> {
  const res = await client.query<ResolutionRow>(
    `INSERT INTO sf_evidence.evidence_resolution (
       resolution_id, tenant_id, cell_id, binding_id, policy_id, version_ref, policy_content_hash,
       application_ref, input_hash, decision_hash, checklist, decision_trace, simulated, created_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15)
     RETURNING *`,
    [
      row.resolutionId,
      row.tenantId,
      row.cellId,
      row.bindingId,
      row.policyId,
      row.versionRef,
      row.policyContentHash,
      row.applicationRef,
      row.inputHash,
      row.decisionHash,
      JSON.stringify(row.checklist),
      JSON.stringify(row.trace),
      row.simulated,
      row.createdBy,
      row.now,
    ],
  );
  return res.rows[0] as ResolutionRow;
}

export async function getResolution(
  client: PoolClient,
  tenantId: string,
  resolutionId: string,
): Promise<ResolutionRow | undefined> {
  const res = await client.query<ResolutionRow>(
    `SELECT * FROM sf_evidence.evidence_resolution WHERE tenant_id = $1 AND resolution_id = $2`,
    [tenantId, resolutionId],
  );
  return res.rows[0];
}
