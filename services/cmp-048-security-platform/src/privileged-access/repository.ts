import type { PoolClient } from 'pg';
import type { PrivilegedAccessRecord } from './model.js';

export async function insertRequested(c: PoolClient, row: PrivilegedAccessRecord): Promise<void> {
  await c.query(
    `INSERT INTO sf_security.privileged_access_record (
      id, tenant_id, grantee_user_id, grantee_actor_type, access_kind, purpose_code, justification,
      support_ticket_ref, scope_actions, scope_resource_types, requested_by, requested_at, status,
      starts_at, expires_at, version
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'REQUESTED',$13,$14,1)`,
    [
      row.id,
      row.tenant_id,
      row.grantee_user_id,
      row.grantee_actor_type,
      row.access_kind,
      row.purpose_code,
      row.justification,
      row.support_ticket_ref ?? null,
      row.scope_actions,
      row.scope_resource_types,
      row.requested_by,
      row.requested_at,
      row.starts_at,
      row.expires_at,
    ],
  );
}

export async function getById(
  c: PoolClient,
  id: string,
): Promise<PrivilegedAccessRecord | undefined> {
  const r = await c.query('SELECT * FROM sf_security.privileged_access_record WHERE id = $1', [id]);
  return r.rows[0] as PrivilegedAccessRecord | undefined;
}

export async function approve(
  c: PoolClient,
  id: string,
  approvedBy: string,
  version: number,
): Promise<void> {
  await c.query(
    `UPDATE sf_security.privileged_access_record
     SET status = 'APPROVED', approved_by = $2, approved_at = now(), version = $3
     WHERE id = $1 AND version = $4`,
    [id, approvedBy, version + 1, version],
  );
}

export async function revoke(
  c: PoolClient,
  id: string,
  revokedBy: string,
  version: number,
): Promise<void> {
  await c.query(
    `UPDATE sf_security.privileged_access_record
     SET status = 'REVOKED', revoked_by = $2, revoked_at = now(), version = $3
     WHERE id = $1 AND version = $4`,
    [id, revokedBy, version + 1, version],
  );
}

export async function review(
  c: PoolClient,
  id: string,
  reviewer: string,
  outcome: string,
): Promise<void> {
  await c.query(
    `UPDATE sf_security.privileged_access_record
     SET post_review_by = $2, post_review_at = now(), post_review_outcome = $3, version = version + 1
     WHERE id = $1`,
    [id, reviewer, outcome],
  );
}
