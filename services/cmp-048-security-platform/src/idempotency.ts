import { createHash } from 'node:crypto';
import { SecurityError } from '@serviceform/security';
import type { PoolClient } from 'pg';

export function fingerprint(body: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
}

export async function remember(
  c: PoolClient,
  opts: {
    tenantId: string | null;
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  },
): Promise<{ replay: boolean; response_ref?: string }> {
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  if (opts.tenantId) {
    const existing = await c.query(
      `SELECT request_fingerprint, status, response_ref FROM sf_security.idempotency_record
       WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [opts.tenantId, opts.principalId, opts.endpoint, opts.key],
    );
    const row = existing.rows[0] as
      { request_fingerprint: string; status: string; response_ref?: string } | undefined;
    if (row) {
      if (row.request_fingerprint !== opts.fingerprint) {
        throw new SecurityError('SF-APP-002', { statusCode: 409 });
      }
      return { replay: true, ...(row.response_ref ? { response_ref: row.response_ref } : {}) };
    }
    await c.query(
      `INSERT INTO sf_security.idempotency_record
        (tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', $6)`,
      [opts.tenantId, opts.principalId, opts.endpoint, opts.key, opts.fingerprint, expires],
    );
    return { replay: false };
  }
  const existing = await c.query(
    `SELECT request_fingerprint, status, response_ref FROM sf_security.idempotency_record_platform
     WHERE principal_id = $1 AND endpoint = $2 AND idempotency_key = $3`,
    [opts.principalId, opts.endpoint, opts.key],
  );
  const row = existing.rows[0] as
    { request_fingerprint: string; status: string; response_ref?: string } | undefined;
  if (row) {
    if (row.request_fingerprint !== opts.fingerprint) {
      throw new SecurityError('SF-APP-002', { statusCode: 409 });
    }
    return { replay: true, ...(row.response_ref ? { response_ref: row.response_ref } : {}) };
  }
  await c.query(
    `INSERT INTO sf_security.idempotency_record_platform
      (principal_id, endpoint, idempotency_key, request_fingerprint, status, expires_at)
     VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5)`,
    [opts.principalId, opts.endpoint, opts.key, opts.fingerprint, expires],
  );
  return { replay: false };
}

export async function complete(
  c: PoolClient,
  opts: {
    tenantId: string | null;
    principalId: string;
    endpoint: string;
    key: string;
    responseRef: string;
  },
): Promise<void> {
  if (opts.tenantId) {
    await c.query(
      `UPDATE sf_security.idempotency_record SET status = 'COMPLETED', response_ref = $5
       WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [opts.tenantId, opts.principalId, opts.endpoint, opts.key, opts.responseRef],
    );
    return;
  }
  await c.query(
    `UPDATE sf_security.idempotency_record_platform SET status = 'COMPLETED', response_ref = $4
     WHERE principal_id = $1 AND endpoint = $2 AND idempotency_key = $3`,
    [opts.principalId, opts.endpoint, opts.key, opts.responseRef],
  );
}
