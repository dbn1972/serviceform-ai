import type { Pool, PoolClient, QueryResult } from 'pg';
import type { RequestRow } from '../../src/repo/request-repo.js';

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
  requests: RequestRow[];
  idem: IdemRow[];
  outbox: unknown[];
}

export function emptyStore(): MemoryStore {
  return { requests: [], idem: [], outbox: [] };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function parsePayload(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function dispatch(store: MemoryStore, sql: string, params: unknown[]): QueryResult {
  const s = compact(sql);
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') return ok([]);
  if (s.includes('set_config')) return ok([]);

  if (s.includes('INSERT INTO sf_maker_checker.idempotency_record')) {
    const exists = store.idem.some(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    if (exists) return ok([], 0);
    store.idem.push({
      tenant_id: String(params[0]),
      principal_id: String(params[1]),
      endpoint: String(params[2]),
      idempotency_key: String(params[3]),
      request_fingerprint: String(params[4]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return ok([], 1);
  }
  if (s.includes('FROM sf_maker_checker.idempotency_record')) {
    const row = store.idem.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_maker_checker.idempotency_record')) {
    const row = store.idem.find(
      (r) =>
        r.tenant_id === String(params[3]) &&
        r.principal_id === String(params[4]) &&
        r.endpoint === String(params[5]) &&
        r.idempotency_key === String(params[6]),
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(params[1]);
      row.response_body = parsePayload(params[2]);
    }
    return ok([]);
  }

  if (s.includes('INSERT INTO sf_maker_checker.publication_request')) {
    const now = new Date(String(params[6]));
    const row: RequestRow = {
      request_id: String(params[0]),
      tenant_id: String(params[1]),
      cell_id: String(params[2]),
      subject_type: 'TENANT_SERVICE_BINDING',
      subject_id: String(params[3]),
      proposed_hash: String(params[4]),
      status: 'DRAFT',
      maker_principal_id: String(params[5]),
      checker_principal_id: null,
      submit_reason: null,
      decision_reason: null,
      ai_advisory: {},
      aggregate_version: 1,
      created_at: now,
      submitted_at: null,
      decided_at: null,
    };
    store.requests.push(row);
    return ok([row], 1);
  }
  if (s.includes("SET status = 'SUBMITTED'")) {
    const row = store.requests.find(
      (r) => r.tenant_id === String(params[3]) && r.request_id === String(params[4]),
    );
    if (!row || row.status !== 'DRAFT') return ok([]);
    row.status = 'SUBMITTED';
    row.submit_reason = params[0] === null ? null : String(params[0]);
    row.ai_advisory = parsePayload(params[1]);
    row.submitted_at = new Date(String(params[2]));
    row.aggregate_version = Number(row.aggregate_version) + 1;
    return ok([row], 1);
  }
  if (s.includes('SET status = $1')) {
    const row = store.requests.find(
      (r) => r.tenant_id === String(params[4]) && r.request_id === String(params[5]),
    );
    if (!row || row.status !== 'SUBMITTED') return ok([]);
    if (String(params[1]) === row.maker_principal_id) {
      const err = Object.assign(new Error('maker cannot approve or reject own request'), {
        code: 'P0001',
        hint: 'SF_MAKER_CHECKER',
      });
      throw err;
    }
    row.status = String(params[0]) as RequestRow['status'];
    row.checker_principal_id = String(params[1]);
    row.decision_reason = String(params[2]);
    row.decided_at = new Date(String(params[3]));
    row.aggregate_version = Number(row.aggregate_version) + 1;
    return ok([row], 1);
  }
  if (s.includes('FROM sf_maker_checker.publication_request')) {
    const row = store.requests.find(
      (r) => r.tenant_id === String(params[0]) && r.request_id === String(params[1]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_maker_checker.outbox_event')) {
    store.outbox.push(params);
    return ok([], 1);
  }

  throw new Error(`unhandled sql: ${s.slice(0, 220)}`);
}

export function createMemoryPool(store: MemoryStore): Pool {
  const connect = async (): Promise<PoolClient> => {
    const client = {
      query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
      release: () => undefined,
    };
    return client as unknown as PoolClient;
  };
  return {
    connect,
    query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
  } as unknown as Pool;
}
