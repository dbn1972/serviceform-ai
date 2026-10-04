import type pg from 'pg';
import { qualified } from './discovery.js';

export interface ClaimedRow {
  schema: string;
  table: string;
  seq: string;
  event_id: string;
  tenant_id?: string;
  topic: string;
  partition_key: string;
  event_type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string;
  envelope: unknown;
  status: string;
  attempts: number;
  next_attempt_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  last_error_code: string | null;
  created_at: Date;
  published_at: Date | null;
}

export async function claimBatch(
  client: pg.PoolClient,
  schema: string,
  table: string,
  workerId: string,
  batchSize: number,
  leaseMs: number,
): Promise<ClaimedRow[]> {
  const rel = qualified(schema, table);
  const returningSql =
    'WITH c AS (SELECT o.seq FROM ' +
    rel +
    " o WHERE o.status = 'PENDING' AND o.next_attempt_at <= now() AND (o.lease_expires_at IS NULL OR o.lease_expires_at < now())" +
    ' AND NOT EXISTS (SELECT 1 FROM ' +
    rel +
    " p WHERE p.partition_key = o.partition_key AND p.seq < o.seq AND p.status <> 'PUBLISHED')" +
    ' ORDER BY o.seq LIMIT $1 FOR UPDATE SKIP LOCKED) ' +
    'UPDATE ' +
    rel +
    " AS t SET lease_owner = $2, lease_expires_at = now() + ($3 * interval '1 millisecond'), attempts = attempts + 1 " +
    'FROM c WHERE t.seq = c.seq RETURNING t.*';
  const result = await client.query<ClaimedRow>(returningSql, [batchSize, workerId, leaseMs]);
  return result.rows.map((row) => ({
    ...row,
    schema,
    table,
    seq: String(row.seq),
  }));
}

export async function markPublished(
  client: pg.PoolClient,
  schema: string,
  table: string,
  seqs: string[],
  workerId: string,
): Promise<number> {
  if (seqs.length === 0) return 0;
  const rel = qualified(schema, table);
  const sql =
    'UPDATE ' +
    rel +
    " SET status = 'PUBLISHED', published_at = now(), lease_owner = NULL, lease_expires_at = NULL" +
    ' WHERE seq = ANY($1::bigint[]) AND lease_owner = $2';
  const result = await client.query(sql, [seqs, workerId]);
  return result.rowCount ?? 0;
}

export async function scheduleRetry(
  client: pg.PoolClient,
  schema: string,
  table: string,
  seq: string,
  workerId: string,
  errorCode: string,
  delayMs: number,
): Promise<number> {
  const rel = qualified(schema, table);
  const sql =
    'UPDATE ' +
    rel +
    " SET next_attempt_at = now() + ($1 * interval '1 millisecond'), last_error_code = $2, lease_owner = NULL, lease_expires_at = NULL" +
    " WHERE seq = $3::bigint AND lease_owner = $4 AND status = 'PENDING'";
  const result = await client.query(sql, [delayMs, errorCode, seq, workerId]);
  return result.rowCount ?? 0;
}

export async function markDeadLettered(
  client: pg.PoolClient,
  schema: string,
  table: string,
  seq: string,
  workerId: string,
  errorCode: string,
): Promise<number> {
  const rel = qualified(schema, table);
  const sql =
    'UPDATE ' +
    rel +
    " SET status = 'DEAD_LETTERED', last_error_code = $1, lease_owner = NULL, lease_expires_at = NULL" +
    " WHERE seq = $2::bigint AND lease_owner = $3 AND status = 'PENDING'";
  const result = await client.query(sql, [errorCode, seq, workerId]);
  return result.rowCount ?? 0;
}

export async function purgePublished(
  client: pg.PoolClient,
  schema: string,
  table: string,
  topic: string,
  retentionSql: string,
  limit: number,
): Promise<number> {
  const rel = qualified(schema, table);
  const sql =
    'DELETE FROM ' +
    rel +
    ' WHERE seq IN (SELECT seq FROM ' +
    rel +
    " WHERE status = 'PUBLISHED' AND topic = $1 AND published_at < now() - $2::interval ORDER BY seq LIMIT $3)";
  const result = await client.query(sql, [topic, retentionSql, limit]);
  return result.rowCount ?? 0;
}

export async function replayDeadLetter(
  client: pg.PoolClient,
  schema: string,
  table: string,
  seq: string,
): Promise<number> {
  const rel = qualified(schema, table);
  const sql =
    'UPDATE ' +
    rel +
    " SET status = 'PENDING', next_attempt_at = now(), lease_owner = NULL, lease_expires_at = NULL" +
    " WHERE seq = $1::bigint AND status = 'DEAD_LETTERED'";
  const result = await client.query(sql, [seq]);
  return result.rowCount ?? 0;
}

export async function discardDeadLetter(
  client: pg.PoolClient,
  schema: string,
  table: string,
  seq: string,
): Promise<number> {
  const rel = qualified(schema, table);
  const sql = 'DELETE FROM ' + rel + " WHERE seq = $1::bigint AND status = 'DEAD_LETTERED'";
  const result = await client.query(sql, [seq]);
  return result.rowCount ?? 0;
}
