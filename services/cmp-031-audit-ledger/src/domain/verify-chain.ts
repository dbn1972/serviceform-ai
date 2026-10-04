import { GENESIS_HASH_HEX, hashChainRow, toHex } from '@serviceform/audit-client';
import type { PoolClient } from 'pg';
import { listPlatformChain, listTenantChain, type LedgerRow } from '../repo/ledger-repo.js';

export interface VerifyFinding {
  seq: number;
  kind: 'HASH_MISMATCH' | 'SEQ_GAP' | 'PREV_HASH' | 'HEAD_MISMATCH' | 'OK';
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  findings: VerifyFinding[];
  length: number;
}

function iso(d: Date): string {
  return d.toISOString();
}

function checkRows(
  rows: LedgerRow[],
  tenantId: string | null,
  head?: { last_seq: number; last_hash: Buffer },
): VerifyReport {
  const findings: VerifyFinding[] = [];
  let prev = Buffer.from(GENESIS_HASH_HEX, 'hex');
  let expectSeq = 1;
  for (const row of rows) {
    const seq = Number(row.chain_seq);
    if (seq !== expectSeq) {
      findings.push({ seq, kind: 'SEQ_GAP', detail: `expected ${String(expectSeq)}` });
    }
    if (!row.prev_hash.equals(prev)) {
      findings.push({ seq, kind: 'PREV_HASH', detail: 'prev_hash mismatch' });
    }
    const computed = hashChainRow({
      tenant_id: tenantId,
      chain_seq: seq,
      recorded_at: iso(row.recorded_at),
      audit_id: row.audit_id,
      event: row.record,
      prev_hash_hex: toHex(row.prev_hash),
    });
    if (!computed.equals(row.row_hash)) {
      findings.push({ seq, kind: 'HASH_MISMATCH', detail: 'row_hash mismatch' });
    }
    prev = Buffer.from(row.row_hash);
    expectSeq = seq + 1;
  }
  if (head && rows.length > 0) {
    const last = rows[rows.length - 1];
    if (
      last &&
      (head.last_seq !== Number(last.chain_seq) || !head.last_hash.equals(last.row_hash))
    ) {
      findings.push({
        seq: Number(last.chain_seq),
        kind: 'HEAD_MISMATCH',
        detail: 'head does not match tail',
      });
    }
  }
  if (head && rows.length === 0 && head.last_seq !== 0) {
    findings.push({ seq: 0, kind: 'HEAD_MISMATCH', detail: 'head without rows' });
  }
  return { ok: findings.length === 0, findings, length: rows.length };
}

export async function verifyTenantChain(
  client: PoolClient,
  tenantId: string,
): Promise<VerifyReport> {
  const rows = await listTenantChain(client, tenantId);
  const head = await client.query<{ last_seq: string; last_hash: Buffer }>(
    'SELECT last_seq::text, last_hash FROM sf_audit.audit_chain_head WHERE tenant_id = $1',
    [tenantId],
  );
  const h = head.rows[0];
  return checkRows(
    rows,
    tenantId,
    h ? { last_seq: Number(h.last_seq), last_hash: h.last_hash } : undefined,
  );
}

export async function verifyPlatformChain(client: PoolClient): Promise<VerifyReport> {
  const rows = await listPlatformChain(client);
  const head = await client.query<{ last_seq: string; last_hash: Buffer }>(
    'SELECT last_seq::text, last_hash FROM sf_audit.audit_chain_head_platform WHERE id = 1',
  );
  const h = head.rows[0];
  return checkRows(
    rows,
    null,
    h ? { last_seq: Number(h.last_seq), last_hash: h.last_hash } : undefined,
  );
}
