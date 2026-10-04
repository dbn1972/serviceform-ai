import type { PoolClient } from 'pg';
import { Cmp004Error } from '../errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export async function claimIdempotency(
  client: PoolClient,
  params: {
    tenantId: string | null;
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  },
): Promise<StoredIdempotent | 'claimed'> {
  const expires = new Date(params.now.getTime() + TTL_MS);
  if (params.tenantId === null) {
    const inserted = await client.query(
      `INSERT INTO sf_identity.idempotency_record_platform (
         principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,'IN_PROGRESS',$5,$6)
       ON CONFLICT (principal_id, endpoint, idempotency_key) DO NOTHING`,
      [
        params.principalId,
        params.endpoint,
        params.key,
        params.fingerprint,
        params.now.toISOString(),
        expires.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return 'claimed';
    return readExisting(client, params);
  }
  const inserted = await client.query(
    `INSERT INTO sf_identity.idempotency_record (
       tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
     ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
     ON CONFLICT (tenant_id, principal_id, endpoint, idempotency_key) DO NOTHING`,
    [
      params.tenantId,
      params.principalId,
      params.endpoint,
      params.key,
      params.fingerprint,
      params.now.toISOString(),
      expires.toISOString(),
    ],
  );
  if ((inserted.rowCount ?? 0) === 1) return 'claimed';
  return readExisting(client, params);
}

async function readExisting(
  client: PoolClient,
  params: {
    tenantId: string | null;
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  },
): Promise<StoredIdempotent> {
  const existing =
    params.tenantId === null
      ? await client.query<{
          request_fingerprint: string;
          status: string;
          response_status: number | null;
          response_body: unknown;
        }>(
          `SELECT request_fingerprint, status, response_status, response_body
             FROM sf_identity.idempotency_record_platform
            WHERE principal_id = $1 AND endpoint = $2 AND idempotency_key = $3`,
          [params.principalId, params.endpoint, params.key],
        )
      : await client.query<{
          request_fingerprint: string;
          status: string;
          response_status: number | null;
          response_body: unknown;
        }>(
          `SELECT request_fingerprint, status, response_status, response_body
             FROM sf_identity.idempotency_record
            WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
          [params.tenantId, params.principalId, params.endpoint, params.key],
        );
  const row = existing.rows[0];
  if (!row) throw new Cmp004Error('SF-SYS-001');
  if (row.request_fingerprint !== params.fingerprint) throw new Cmp004Error('SF-APP-002');
  if (row.status === 'COMPLETED' && row.response_status !== null) {
    return { status: row.response_status, body: row.response_body };
  }
  throw new Cmp004Error('SF-APP-002');
}

export async function completeIdempotency(
  client: PoolClient,
  params: {
    tenantId: string | null;
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  },
): Promise<void> {
  if (params.tenantId === null) {
    await client.query(
      `UPDATE sf_identity.idempotency_record_platform
          SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
        WHERE principal_id = $4 AND endpoint = $5 AND idempotency_key = $6`,
      [
        `sf_identity.idempotency_record_platform:${params.principalId}:${params.key}`,
        params.status,
        JSON.stringify(params.body),
        params.principalId,
        params.endpoint,
        params.key,
      ],
    );
    return;
  }
  await client.query(
    `UPDATE sf_identity.idempotency_record
        SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
      WHERE tenant_id = $4 AND principal_id = $5 AND endpoint = $6 AND idempotency_key = $7`,
    [
      `sf_identity.idempotency_record:${params.tenantId}:${params.key}`,
      params.status,
      JSON.stringify(params.body),
      params.tenantId,
      params.principalId,
      params.endpoint,
      params.key,
    ],
  );
}
