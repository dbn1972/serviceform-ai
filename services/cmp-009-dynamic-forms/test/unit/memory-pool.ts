import type { Pool, PoolClient, QueryResult } from 'pg';
import type { ExecutionRow, SnapshotRow } from '../../src/repo/forms-repo.js';

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
  executions: ExecutionRow[];
  idem: IdemRow[];
  outbox: unknown[][];
}

export function emptyStore(): MemoryStore {
  return { snapshots: [], executions: [], idem: [], outbox: [] };
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

  if (s.includes('INSERT INTO sf_forms.idempotency_record')) {
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
  if (s.includes('FROM sf_forms.idempotency_record')) {
    const row = store.idem.find((r) => idemMatch(r, p, 0));
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_forms.idempotency_record')) {
    const row = store.idem.find((r) => idemMatch(r, p, 3));
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(p[1]);
      row.response_body = parse(p[2]);
    }
    return ok([]);
  }
  if (s.includes('INSERT INTO sf_forms.form_definition_snapshot')) {
    const exists = store.snapshots.some(
      (r) => r.tenant_id === p[1] && r.form_key === p[3] && r.content_hash === p[4],
    );
    if (!exists) {
      store.snapshots.push({
        snapshot_id: String(p[0]),
        tenant_id: String(p[1]),
        cell_id: String(p[2]),
        form_key: String(p[3]),
        content_hash: String(p[4]),
        payload_digest: String(p[5]),
        payload: parse(p[6]),
        created_by: String(p[7]),
        created_at: new Date(String(p[8])),
      });
    }
    return ok([], exists ? 0 : 1);
  }
  if (s.includes('FROM sf_forms.form_definition_snapshot')) {
    const row = store.snapshots.find(
      (r) => r.tenant_id === p[0] && r.form_key === p[1] && r.content_hash === p[2],
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_forms.form_execution_record')) {
    const row: ExecutionRow = {
      execution_id: String(p[0]),
      tenant_id: String(p[1]),
      cell_id: String(p[2]),
      snapshot_id: String(p[3]),
      form_key: String(p[4]),
      version_id: String(p[5]),
      content_hash: String(p[6]),
      data_hash: String(p[7]),
      purpose_code: String(p[8]),
      locale: String(p[9]),
      result_code: p[10] as ExecutionRow['result_code'],
      visible_fields: parse(p[11]) as string[],
      required_fields: parse(p[12]) as string[],
      errors: parse(p[13]) as ExecutionRow['errors'],
      renderer_ids: parse(p[14]) as string[],
      requested_by: String(p[15]),
      evaluated_at: new Date(String(p[16])),
    };
    store.executions.push(row);
    return ok([row], 1);
  }
  if (s.includes('FROM sf_forms.form_execution_record')) {
    const row = store.executions.find(
      (r) => r.tenant_id === String(p[0]) && r.execution_id === String(p[1]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_forms.outbox_event')) {
    store.outbox.push(p);
    return ok([], 1);
  }
  throw new Error(`unhandled sql: ${s}`);
}

export function createMemoryPool(store: MemoryStore): Pool {
  const client = {
    query: (sql: string, params: unknown[] = []) => Promise.resolve(dispatch(store, sql, params)),
    release: () => undefined,
  } as unknown as PoolClient;
  return {
    connect: async () => client,
  } as unknown as Pool;
}
