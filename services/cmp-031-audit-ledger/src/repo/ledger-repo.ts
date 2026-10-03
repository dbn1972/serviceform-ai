import type { PoolClient } from 'pg';
import { GENESIS_HASH_HEX } from '@serviceform/audit-client';

export interface HeadRow {
  last_seq: string;
  last_hash: Buffer;
  last_recorded_at: Date;
}

export interface KeyRow {
  chain_seq: string;
  recorded_at: Date;
  content_hash: Buffer;
}

export interface LedgerRow {
  tenant_id: string | null;
  chain_seq: string;
  recorded_at: Date;
  audit_id: string;
  record: unknown;
  prev_hash: Buffer;
  row_hash: Buffer;
}

const ZERO = Buffer.from(GENESIS_HASH_HEX, 'hex');

export async function lockTenantHead(client: PoolClient, tenantId: string): Promise<HeadRow> {
  await client.query(
    `INSERT INTO sf_audit.audit_chain_head (tenant_id, last_seq, last_hash, last_recorded_at)
     VALUES ($1, 0, $2, TIMESTAMPTZ '1970-01-01 00:00:00+00')
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, ZERO],
  );
  const res = await client.query<HeadRow>(
    `SELECT last_seq::text AS last_seq, last_hash, last_recorded_at
     FROM sf_audit.audit_chain_head WHERE tenant_id = $1 FOR UPDATE`,
    [tenantId],
  );
  const row = res.rows[0];
  if (!row) throw new Error('tenant head missing after lock');
  return row;
}

export async function lockPlatformHead(client: PoolClient): Promise<HeadRow> {
  const res = await client.query<HeadRow>(
    `SELECT last_seq::text AS last_seq, last_hash, last_recorded_at
     FROM sf_audit.audit_chain_head_platform WHERE id = 1 FOR UPDATE`,
  );
  const row = res.rows[0];
  if (!row) throw new Error('platform head missing');
  return row;
}

export async function findTenantKey(
  client: PoolClient,
  tenantId: string,
  auditId: string,
): Promise<KeyRow | undefined> {
  const res = await client.query<KeyRow>(
    `SELECT chain_seq::text AS chain_seq, recorded_at, content_hash
     FROM sf_audit.audit_event_key WHERE tenant_id = $1 AND audit_id = $2`,
    [tenantId, auditId],
  );
  return res.rows[0];
}

export async function findPlatformKey(
  client: PoolClient,
  auditId: string,
): Promise<KeyRow | undefined> {
  const res = await client.query<KeyRow>(
    `SELECT chain_seq::text AS chain_seq, recorded_at, content_hash
     FROM sf_audit.audit_event_platform_key WHERE audit_id = $1`,
    [auditId],
  );
  return res.rows[0];
}

export async function insertTenantLedger(
  client: PoolClient,
  args: {
    tenantId: string;
    chainSeq: number;
    recordedAt: Date;
    auditId: string;
    record: unknown;
    prevHash: Buffer;
    rowHash: Buffer;
    contentHash: Buffer;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sf_audit.audit_event_key (tenant_id, audit_id, chain_seq, recorded_at, content_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [args.tenantId, args.auditId, args.chainSeq, args.recordedAt, args.contentHash],
  );
  await client.query(
    `INSERT INTO sf_audit.audit_event
       (tenant_id, chain_seq, recorded_at, audit_id, record, prev_hash, row_hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      args.tenantId,
      args.chainSeq,
      args.recordedAt,
      args.auditId,
      JSON.stringify(args.record),
      args.prevHash,
      args.rowHash,
    ],
  );
}

export async function insertPlatformLedger(
  client: PoolClient,
  args: {
    chainSeq: number;
    recordedAt: Date;
    auditId: string;
    record: unknown;
    prevHash: Buffer;
    rowHash: Buffer;
    contentHash: Buffer;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sf_audit.audit_event_platform_key (audit_id, chain_seq, recorded_at, content_hash)
     VALUES ($1, $2, $3, $4)`,
    [args.auditId, args.chainSeq, args.recordedAt, args.contentHash],
  );
  await client.query(
    `INSERT INTO sf_audit.audit_event_platform
       (chain_seq, recorded_at, audit_id, record, prev_hash, row_hash)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      args.chainSeq,
      args.recordedAt,
      args.auditId,
      JSON.stringify(args.record),
      args.prevHash,
      args.rowHash,
    ],
  );
}

export async function updateTenantHead(
  client: PoolClient,
  tenantId: string,
  seq: number,
  hash: Buffer,
  recordedAt: Date,
): Promise<void> {
  await client.query(
    `UPDATE sf_audit.audit_chain_head
     SET last_seq = $2, last_hash = $3, last_recorded_at = $4
     WHERE tenant_id = $1`,
    [tenantId, seq, hash, recordedAt],
  );
}

export async function updatePlatformHead(
  client: PoolClient,
  seq: number,
  hash: Buffer,
  recordedAt: Date,
): Promise<void> {
  await client.query(
    `UPDATE sf_audit.audit_chain_head_platform
     SET last_seq = $1, last_hash = $2, last_recorded_at = $3
     WHERE id = 1`,
    [seq, hash, recordedAt],
  );
}

export async function nextRecordedAt(client: PoolClient, last: Date): Promise<Date> {
  const res = await client.query<{ recorded_at: Date }>(
    `SELECT GREATEST(date_trunc('milliseconds', clock_timestamp()), $1::timestamptz) AS recorded_at`,
    [last],
  );
  const row = res.rows[0];
  if (!row) throw new Error('clock read failed');
  return row.recorded_at;
}

export async function listTenantChain(client: PoolClient, tenantId: string): Promise<LedgerRow[]> {
  const res = await client.query<LedgerRow>(
    `SELECT e.tenant_id::text, e.chain_seq::text, e.recorded_at, e.audit_id::text, e.record, e.prev_hash, e.row_hash
     FROM sf_audit.audit_event e WHERE e.tenant_id = $1 ORDER BY e.chain_seq`,
    [tenantId],
  );
  return res.rows;
}

export async function listPlatformChain(client: PoolClient): Promise<LedgerRow[]> {
  const res = await client.query<LedgerRow>(
    `SELECT NULL::text AS tenant_id, e.chain_seq::text, e.recorded_at, e.audit_id::text, e.record, e.prev_hash, e.row_hash
     FROM sf_audit.audit_event_platform e ORDER BY e.chain_seq`,
  );
  return res.rows;
}
