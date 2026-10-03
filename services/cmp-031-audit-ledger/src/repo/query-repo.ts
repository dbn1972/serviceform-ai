import type { AuditEvent } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { encodeCursor, type AuditQuery } from '../domain/query-filters.js';

export interface AuditListItem {
  event: AuditEvent;
  ledger: { chain_seq: number; recorded_at: string; row_hash: string };
}

export interface QueryPage {
  items: AuditListItem[];
  next_cursor?: string;
}

function toItem(row: {
  chain_seq: string;
  recorded_at: Date;
  record: AuditEvent;
  row_hash: Buffer;
}): AuditListItem {
  return {
    event: row.record,
    ledger: {
      chain_seq: Number(row.chain_seq),
      recorded_at: row.recorded_at.toISOString(),
      row_hash: row.row_hash.toString('hex'),
    },
  };
}

export async function queryTenantAudit(
  client: PoolClient,
  tenantId: string,
  q: AuditQuery,
): Promise<QueryPage> {
  const params: unknown[] = [tenantId, q.from, q.to];
  const where: string[] = ['tenant_id = $1', 'recorded_at >= $2', 'recorded_at <= $3'];
  if (q.actor_id !== undefined) {
    params.push(q.actor_id);
    where.push(`record->>'actor_id' = $${String(params.length)}`);
  }
  if (q.action !== undefined) {
    params.push(q.action);
    where.push(`record->>'action' = $${String(params.length)}`);
  }
  if (q.action_class !== undefined) {
    params.push(q.action_class);
    where.push(`record->>'action_class' = $${String(params.length)}`);
  }
  if (q.resource_type !== undefined) {
    params.push(q.resource_type);
    where.push(`record->>'resource_type' = $${String(params.length)}`);
  }
  if (q.resource_id !== undefined) {
    params.push(q.resource_id);
    where.push(`record->>'resource_id' = $${String(params.length)}`);
  }
  if (q.result !== undefined) {
    params.push(q.result);
    where.push(`record->>'result' = $${String(params.length)}`);
  }
  if (q.correlation_id !== undefined) {
    params.push(q.correlation_id);
    where.push(`record->>'correlation_id' = $${String(params.length)}`);
  }
  if (q.cursor !== undefined) {
    params.push(q.cursor.recorded_at, q.cursor.chain_seq);
    where.push(
      `(recorded_at, chain_seq) > ($${String(params.length - 1)}::timestamptz, $${String(params.length)}::bigint)`,
    );
  }
  params.push(q.limit + 1);
  const sql = `SELECT chain_seq::text, recorded_at, record, row_hash
     FROM sf_audit.audit_event
     WHERE ${where.join(' AND ')}
     ORDER BY recorded_at ASC, chain_seq ASC
     LIMIT $${String(params.length)}`;
  const res = await client.query<{
    chain_seq: string;
    recorded_at: Date;
    record: AuditEvent;
    row_hash: Buffer;
  }>(sql, params);
  const rows = res.rows;
  const hasMore = rows.length > q.limit;
  const slice = hasMore ? rows.slice(0, q.limit) : rows;
  const items = slice.map(toItem);
  const page: QueryPage = { items };
  const last = slice[slice.length - 1];
  if (hasMore && last) {
    page.next_cursor = encodeCursor(last.recorded_at.toISOString(), Number(last.chain_seq));
  }
  return page;
}
