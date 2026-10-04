import type { PoolClient } from 'pg';

export type RequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export interface RequestRow {
  request_id: string;
  tenant_id: string;
  cell_id: string;
  subject_type: 'TENANT_SERVICE_BINDING';
  subject_id: string;
  proposed_hash: string;
  status: RequestStatus;
  maker_principal_id: string;
  checker_principal_id: string | null;
  submit_reason: string | null;
  decision_reason: string | null;
  ai_advisory: unknown;
  aggregate_version: string | number;
  created_at: Date;
  submitted_at: Date | null;
  decided_at: Date | null;
}

export async function insertRequest(
  client: PoolClient,
  row: {
    requestId: string;
    tenantId: string;
    cellId: string;
    subjectId: string;
    proposedHash: string;
    makerId: string;
    now: Date;
  },
): Promise<RequestRow> {
  const res = await client.query<RequestRow>(
    `INSERT INTO sf_maker_checker.publication_request (
       request_id, tenant_id, cell_id, subject_type, subject_id, proposed_hash, status,
       maker_principal_id, created_at
     ) VALUES ($1,$2,$3,'TENANT_SERVICE_BINDING',$4,$5,'DRAFT',$6,$7)
     RETURNING *`,
    [
      row.requestId,
      row.tenantId,
      row.cellId,
      row.subjectId,
      row.proposedHash,
      row.makerId,
      row.now,
    ],
  );
  return res.rows[0] as RequestRow;
}

export async function getRequest(
  client: PoolClient,
  tenantId: string,
  requestId: string,
): Promise<RequestRow | undefined> {
  const res = await client.query<RequestRow>(
    `SELECT * FROM sf_maker_checker.publication_request WHERE tenant_id = $1 AND request_id = $2`,
    [tenantId, requestId],
  );
  return res.rows[0];
}

export async function markSubmitted(
  client: PoolClient,
  params: {
    tenantId: string;
    requestId: string;
    reason: string | null;
    aiAdvisory: unknown;
    now: Date;
  },
): Promise<RequestRow | undefined> {
  const res = await client.query<RequestRow>(
    `UPDATE sf_maker_checker.publication_request
        SET status = 'SUBMITTED',
            submit_reason = $1,
            ai_advisory = $2::jsonb,
            submitted_at = $3,
            aggregate_version = aggregate_version + 1
      WHERE tenant_id = $4 AND request_id = $5 AND status = 'DRAFT'
      RETURNING *`,
    [
      params.reason,
      JSON.stringify(params.aiAdvisory),
      params.now,
      params.tenantId,
      params.requestId,
    ],
  );
  return res.rows[0];
}

export async function markDecided(
  client: PoolClient,
  params: {
    tenantId: string;
    requestId: string;
    status: 'APPROVED' | 'REJECTED';
    checkerId: string;
    reason: string;
    now: Date;
  },
): Promise<RequestRow | undefined> {
  const res = await client.query<RequestRow>(
    `UPDATE sf_maker_checker.publication_request
        SET status = $1,
            checker_principal_id = $2,
            decision_reason = $3,
            decided_at = $4,
            aggregate_version = aggregate_version + 1
      WHERE tenant_id = $5 AND request_id = $6 AND status = 'SUBMITTED'
      RETURNING *`,
    [params.status, params.checkerId, params.reason, params.now, params.tenantId, params.requestId],
  );
  return res.rows[0];
}
