import type { Pool, PoolClient, QueryResult } from 'pg';
import type { ArtifactRow, BindingRow } from '../../src/repo/version-repo.js';

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
  bindings: BindingRow[];
  artifacts: ArtifactRow[];
  idem: IdemRow[];
  outbox: unknown[];
}

export function emptyStore(): MemoryStore {
  return { bindings: [], artifacts: [], idem: [], outbox: [] };
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

  if (s.includes('INSERT INTO sf_versioning.idempotency_record')) {
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
  if (s.includes('FROM sf_versioning.idempotency_record')) {
    const row = store.idem.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_versioning.idempotency_record')) {
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

  if (s.includes('INSERT INTO sf_versioning.tenant_service_binding')) {
    const now = new Date(String(params[10]));
    const row: BindingRow = {
      binding_id: String(params[0]),
      tenant_id: String(params[1]),
      cell_id: String(params[2]),
      binding_key: String(params[3]),
      offering_ref: String(params[4]),
      metadata_bundle_ref: String(params[5]),
      pins: parsePayload(params[6]) as BindingRow['pins'],
      dependency_graph: parsePayload(params[7]),
      artifact_hash: String(params[8]),
      status: 'DRAFT',
      published_version_id: null,
      aggregate_version: 1,
      created_by: String(params[9]),
      created_at: now,
      updated_at: now,
      published_at: null,
    };
    store.bindings.push(row);
    return ok([row], 1);
  }
  if (s.includes('UPDATE sf_versioning.tenant_service_binding') && s.includes('offering_ref')) {
    const row = store.bindings.find(
      (b) => b.tenant_id === String(params[6]) && b.binding_id === String(params[7]),
    );
    if (!row || row.status !== 'DRAFT') return ok([]);
    row.offering_ref = String(params[0]);
    row.metadata_bundle_ref = String(params[1]);
    row.pins = parsePayload(params[2]) as BindingRow['pins'];
    row.dependency_graph = parsePayload(params[3]);
    row.artifact_hash = String(params[4]);
    row.updated_at = new Date(String(params[5]));
    row.aggregate_version = Number(row.aggregate_version) + 1;
    return ok([row], 1);
  }
  if (s.includes("SET status = 'PUBLISHED'")) {
    const row = store.bindings.find(
      (b) => b.tenant_id === String(params[2]) && b.binding_id === String(params[3]),
    );
    if (!row || row.status !== 'DRAFT') return ok([]);
    row.status = 'PUBLISHED';
    row.published_version_id = String(params[0]);
    row.published_at = new Date(String(params[1]));
    row.updated_at = row.published_at;
    row.aggregate_version = Number(row.aggregate_version) + 1;
    return ok([row], 1);
  }
  if (s.includes('FROM sf_versioning.tenant_service_binding')) {
    const row = store.bindings.find(
      (b) => b.tenant_id === String(params[0]) && b.binding_id === String(params[1]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('COALESCE(MAX(version_no)')) {
    const max = store.artifacts
      .filter((a) => a.tenant_id === String(params[0]) && a.artifact_key === String(params[1]))
      .reduce((m, a) => Math.max(m, Number(a.version_no)), 0);
    return ok([{ n: String(max) }]);
  }
  if (s.includes('INSERT INTO sf_versioning.artifact_version')) {
    const now = new Date(String(params[9]));
    const row: ArtifactRow = {
      version_id: String(params[0]),
      tenant_id: String(params[1]),
      cell_id: String(params[2]),
      artifact_kind: 'TENANT_SERVICE_BINDING',
      artifact_key: String(params[3]),
      version_no: Number(params[4]),
      content_hash: String(params[5]),
      dependency_graph: parsePayload(params[6]),
      source_binding_id: String(params[7]),
      status: 'PUBLISHED',
      created_by: String(params[8]),
      created_at: now,
      published_at: now,
    };
    store.artifacts.push(row);
    return ok([row], 1);
  }
  if (s.includes('FROM sf_versioning.artifact_version WHERE tenant_id')) {
    const row = store.artifacts.find(
      (a) => a.tenant_id === String(params[0]) && a.version_id === String(params[1]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_versioning.outbox_event')) {
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
