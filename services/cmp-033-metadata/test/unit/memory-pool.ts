import type { Pool, PoolClient, QueryResult } from 'pg';
import type { DocumentRow } from '../../src/repo/document-repo.js';
import type { BundleRow } from '../../src/repo/bundle-repo.js';

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
  documents: DocumentRow[];
  bundles: BundleRow[];
  idem: IdemRow[];
  outbox: unknown[];
}

export function emptyStore(): MemoryStore {
  return { documents: [], bundles: [], idem: [], outbox: [] };
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

  if (s.includes('INSERT INTO sf_metadata.idempotency_record')) {
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
  if (s.includes('FROM sf_metadata.idempotency_record')) {
    const row = store.idem.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_metadata.idempotency_record')) {
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

  if (s.includes('INSERT INTO sf_metadata.metadata_document')) {
    const now = new Date(String(params[9]));
    const row: DocumentRow = {
      document_id: String(params[0]),
      tenant_id: String(params[1]),
      cell_id: String(params[2]),
      document_key: String(params[3]),
      kind: params[4] as DocumentRow['kind'],
      schema_id: String(params[5]),
      payload: parsePayload(params[6]),
      payload_hash: String(params[7]),
      status: 'DRAFT',
      aggregate_version: '1',
      created_by: String(params[8]),
      created_at: now,
      updated_at: now,
      validated_at: null,
      published_at: null,
    };
    store.documents.push(row);
    return ok([row], 1);
  }
  if (s.includes('UPDATE sf_metadata.metadata_document') && s.includes("status = 'DRAFT'")) {
    const row = store.documents.find(
      (d) => d.tenant_id === String(params[4]) && d.document_id === String(params[5]),
    );
    if (!row) return ok([]);
    row.payload = parsePayload(params[0]);
    row.payload_hash = String(params[1]);
    row.schema_id = String(params[2]);
    row.status = 'DRAFT';
    row.validated_at = null;
    row.aggregate_version = String(Number(row.aggregate_version) + 1);
    row.updated_at = new Date(String(params[3]));
    return ok([row], 1);
  }
  if (s.includes("SET status = 'VALIDATED'")) {
    const row = store.documents.find(
      (d) => d.tenant_id === String(params[1]) && d.document_id === String(params[2]),
    );
    if (!row) return ok([]);
    row.status = 'VALIDATED';
    row.validated_at = new Date(String(params[0]));
    row.aggregate_version = String(Number(row.aggregate_version) + 1);
    row.updated_at = row.validated_at;
    return ok([row], 1);
  }
  if (s.includes("SET status = 'PUBLISHED'")) {
    const row = store.documents.find(
      (d) => d.tenant_id === String(params[1]) && d.document_id === String(params[2]),
    );
    if (!row) return ok([]);
    row.status = 'PUBLISHED';
    row.published_at = new Date(String(params[0]));
    row.aggregate_version = String(Number(row.aggregate_version) + 1);
    row.updated_at = row.published_at;
    return ok([row], 1);
  }
  if (s.includes('CASE WHEN status =')) {
    const ids = params[2] as string[];
    for (const row of store.documents) {
      if (row.tenant_id === String(params[1]) && ids.includes(row.document_id)) {
        if (row.status !== 'PUBLISHED') row.status = 'COMPOSED';
        row.aggregate_version = String(Number(row.aggregate_version) + 1);
        row.updated_at = new Date(String(params[0]));
      }
    }
    return ok([]);
  }
  if (s.includes('document_id = ANY')) {
    const ids = params[1] as string[];
    return ok(
      store.documents.filter(
        (d) => d.tenant_id === String(params[0]) && ids.includes(d.document_id),
      ),
    );
  }
  if (s.includes('FROM sf_metadata.metadata_document WHERE tenant_id')) {
    const row = store.documents.find(
      (d) => d.tenant_id === String(params[0]) && d.document_id === String(params[1]),
    );
    return ok(row ? [row] : []);
  }

  if (s.includes('INSERT INTO sf_metadata.metadata_bundle')) {
    const now = new Date(String(params[8]));
    const row: BundleRow = {
      bundle_id: String(params[0]),
      tenant_id: String(params[1]),
      cell_id: String(params[2]),
      bundle_key: String(params[3]),
      composition_hash: String(params[4]),
      document_ids: params[5] as string[],
      missing_kinds: params[6] as string[],
      status: 'COMPOSED',
      aggregate_version: '1',
      created_by: String(params[7]),
      created_at: now,
      published_at: null,
    };
    store.bundles.push(row);
    return ok([row], 1);
  }
  if (s.includes('INSERT INTO sf_metadata.outbox_event')) {
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
