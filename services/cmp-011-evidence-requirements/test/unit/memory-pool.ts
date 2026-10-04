import type { Pool, PoolClient, QueryResult } from 'pg';
import type { PolicyRow, ResolutionRow } from '../../src/repo/evidence-repo.js';

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
  policies: PolicyRow[];
  resolutions: ResolutionRow[];
  idem: IdemRow[];
  outbox: unknown[][];
  txBegun: number;
}

export function emptyStore(): MemoryStore {
  return { policies: [], resolutions: [], idem: [], outbox: [], txBegun: 0 };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function parse(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function dispatch(store: MemoryStore, sql: string, p: unknown[]): QueryResult {
  const s = sql.replace(/\s+/g, ' ').trim();
  const upper = s.toUpperCase();
  if (upper === 'BEGIN') {
    store.txBegun += 1;
    return ok([]);
  }
  if (upper === 'COMMIT' || upper === 'ROLLBACK' || s.includes('set_config')) return ok([]);

  if (s.includes('INSERT INTO sf_evidence.idempotency_record')) {
    const exists = store.idem.some(
      (r) =>
        r.tenant_id === String(p[0]) &&
        r.principal_id === String(p[1]) &&
        r.endpoint === String(p[2]) &&
        r.idempotency_key === String(p[3]),
    );
    if (exists) return ok([], 0);
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
  if (s.includes('FROM sf_evidence.idempotency_record')) {
    const row = store.idem.find(
      (r) =>
        r.tenant_id === String(p[0]) &&
        r.principal_id === String(p[1]) &&
        r.endpoint === String(p[2]) &&
        r.idempotency_key === String(p[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_evidence.idempotency_record')) {
    const row = store.idem.find(
      (r) =>
        r.tenant_id === String(p[3]) &&
        r.principal_id === String(p[4]) &&
        r.endpoint === String(p[5]) &&
        r.idempotency_key === String(p[6]),
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(p[1]);
      row.response_body = parse(p[2]);
    }
    return ok([]);
  }

  if (s.includes('INSERT INTO sf_evidence.evidence_policy')) {
    const now = new Date(String(p[7]));
    const row: PolicyRow = {
      policy_id: String(p[0]),
      tenant_id: String(p[1]),
      cell_id: String(p[2]),
      policy_key: String(p[3]),
      status: 'DRAFT',
      version_no: null,
      version_ref: null,
      definition: parse(p[4]),
      content_hash: String(p[5]),
      aggregate_version: 1,
      created_by: String(p[6]),
      created_at: now,
      updated_at: now,
      published_at: null,
    };
    store.policies.push(row);
    return ok([row], 1);
  }
  if (s.includes('UPDATE sf_evidence.evidence_policy SET definition')) {
    const row = store.policies.find(
      (r) => r.tenant_id === String(p[3]) && r.policy_id === String(p[4]),
    );
    if (!row || row.status !== 'DRAFT') return ok([]);
    row.definition = parse(p[0]);
    row.content_hash = String(p[1]);
    row.updated_at = new Date(String(p[2]));
    row.aggregate_version = Number(row.aggregate_version) + 1;
    return ok([row], 1);
  }
  if (s.includes("SET status = 'PUBLISHED'")) {
    const row = store.policies.find(
      (r) => r.tenant_id === String(p[3]) && r.policy_id === String(p[4]),
    );
    if (!row || row.status !== 'DRAFT') return ok([]);
    row.status = 'PUBLISHED';
    row.version_no = Number(p[0]);
    row.version_ref = String(p[1]);
    row.published_at = new Date(String(p[2]));
    row.updated_at = row.published_at;
    row.aggregate_version = Number(row.aggregate_version) + 1;
    return ok([row], 1);
  }
  if (s.includes('COALESCE(MAX(version_no)')) {
    const max = store.policies
      .filter(
        (r) =>
          r.tenant_id === String(p[0]) && r.policy_key === String(p[1]) && r.status === 'PUBLISHED',
      )
      .reduce((m, r) => Math.max(m, Number(r.version_no)), 0);
    return ok([{ n: String(max + 1) }]);
  }
  if (s.includes('FROM sf_evidence.evidence_policy WHERE tenant_id = $1 AND version_ref')) {
    const row = store.policies.find(
      (r) =>
        r.tenant_id === String(p[0]) && r.version_ref === String(p[1]) && r.status === 'PUBLISHED',
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('FROM sf_evidence.evidence_policy WHERE tenant_id = $1 AND policy_id')) {
    const row = store.policies.find(
      (r) => r.tenant_id === String(p[0]) && r.policy_id === String(p[1]),
    );
    return ok(row ? [row] : []);
  }

  if (s.includes('INSERT INTO sf_evidence.evidence_resolution')) {
    const row: ResolutionRow = {
      resolution_id: String(p[0]),
      tenant_id: String(p[1]),
      cell_id: String(p[2]),
      binding_id: String(p[3]),
      policy_id: String(p[4]),
      version_ref: String(p[5]),
      policy_content_hash: String(p[6]),
      application_ref: p[7] === null ? null : String(p[7]),
      input_hash: String(p[8]),
      decision_hash: String(p[9]),
      checklist: parse(p[10]),
      decision_trace: parse(p[11]),
      simulated: Boolean(p[12]),
      created_by: String(p[13]),
      created_at: new Date(String(p[14])),
    };
    store.resolutions.push(row);
    return ok([row], 1);
  }
  if (s.includes('FROM sf_evidence.evidence_resolution')) {
    const row = store.resolutions.find(
      (r) => r.tenant_id === String(p[0]) && r.resolution_id === String(p[1]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_evidence.outbox_event')) {
    store.outbox.push(p);
    return ok([], 1);
  }
  throw new Error(`unhandled sql: ${s.slice(0, 200)}`);
}

export function createMemoryPool(store: MemoryStore): Pool {
  const connect = async (): Promise<PoolClient> =>
    ({
      query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
      release: () => undefined,
    }) as unknown as PoolClient;
  return {
    connect,
    query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
  } as unknown as Pool;
}
