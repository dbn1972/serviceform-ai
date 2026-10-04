import type { Pool, PoolClient, QueryResult } from 'pg';
import type { EvaluationRow, SnapshotRow } from '../../src/repo/rules-repo.js';

export interface IdemRow {
  tenant_id: string;
  principal_id: string;
  endpoint: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
}

export interface MemoryStore {
  snapshots: SnapshotRow[];
  evaluations: EvaluationRow[];
  idem: IdemRow[];
  outbox: unknown[][];
}

export function emptyStore(): MemoryStore {
  return { snapshots: [], evaluations: [], idem: [], outbox: [] };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

const compact = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

function parse(raw: unknown): unknown {
  return typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
}

function idemMatch(r: IdemRow, p: unknown[], at: number): boolean {
  return (
    r.tenant_id === String(p[at]) &&
    r.principal_id === String(p[at + 1]) &&
    r.endpoint === String(p[at + 2]) &&
    r.idempotency_key === String(p[at + 3])
  );
}

function dispatch(store: MemoryStore, sql: string, p: unknown[]): QueryResult {
  const s = compact(sql);
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') return ok([]);
  if (s.includes('set_config')) return ok([]);

  if (s.includes('INSERT INTO sf_rules.idempotency_record')) {
    if (store.idem.some((r) => idemMatch(r, p, 0))) return ok([], 0);
    store.idem.push({
      tenant_id: String(p[0]),
      principal_id: String(p[1]),
      endpoint: String(p[2]),
      idempotency_key: String(p[3]),
      request_fingerprint: String(p[4]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return ok([], 1);
  }
  if (s.includes('FROM sf_rules.idempotency_record')) {
    const row = store.idem.find((r) => idemMatch(r, p, 0));
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_rules.idempotency_record')) {
    const row = store.idem.find((r) => idemMatch(r, p, 3));
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(p[1]);
      row.response_body = parse(p[2]);
    }
    return ok([]);
  }
  if (s.includes('INSERT INTO sf_rules.rule_pack_snapshot')) {
    const exists = store.snapshots.some(
      (r) => r.tenant_id === p[1] && r.pack_key === p[3] && r.content_hash === p[4],
    );
    if (!exists) {
      store.snapshots.push({
        snapshot_id: String(p[0]),
        tenant_id: String(p[1]),
        cell_id: String(p[2]),
        pack_key: String(p[3]),
        content_hash: String(p[4]),
        payload_digest: String(p[5]),
        payload: parse(p[6]),
        created_by: String(p[7]),
        created_at: new Date(String(p[8])),
      });
    }
    return ok([], exists ? 0 : 1);
  }
  if (s.includes('FROM sf_rules.rule_pack_snapshot')) {
    const row = store.snapshots.find(
      (r) => r.tenant_id === p[0] && r.pack_key === p[1] && r.content_hash === p[2],
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_rules.evaluation_record')) {
    const row: EvaluationRow = {
      evaluation_id: String(p[0]),
      tenant_id: String(p[1]),
      cell_id: String(p[2]),
      snapshot_id: String(p[3]),
      pack_key: String(p[4]),
      version_id: String(p[5]),
      content_hash: String(p[6]),
      input_hash: String(p[7]),
      purpose_code: String(p[8]),
      subject_ref: p[9] === null ? null : String(p[9]),
      outcome: p[10] === null ? null : String(p[10]),
      result_code: String(p[11]) as EvaluationRow['result_code'],
      reason_codes: parse(p[12]) as string[],
      outputs: parse(p[13]) as EvaluationRow['outputs'],
      matched_rules: parse(p[14]) as EvaluationRow['matched_rules'],
      engine_name: String(p[15]),
      engine_version: String(p[16]),
      simulation: p[17] === null ? null : (parse(p[17]) as EvaluationRow['simulation']),
      requested_by: String(p[18]),
      evaluated_at: new Date(String(p[19])),
    };
    store.evaluations.push(row);
    return ok([row], 1);
  }
  if (s.includes('FROM sf_rules.evaluation_record')) {
    const row = store.evaluations.find((r) => r.tenant_id === p[0] && r.evaluation_id === p[1]);
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_rules.outbox_event')) {
    store.outbox.push(p);
    return ok([], 1);
  }
  throw new Error(`unhandled sql: ${s.slice(0, 200)}`);
}

export function createMemoryPool(store: MemoryStore): Pool {
  const client = {
    query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
    release: () => undefined,
  } as unknown as PoolClient;
  return {
    connect: async () => client,
    query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
  } as unknown as Pool;
}
