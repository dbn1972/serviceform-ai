import type { Pool, PoolClient, QueryResult } from 'pg';

export interface MemoryStore {
  elements: {
    element_id: string;
    version: number;
    element_code: string;
    lifecycle_status: string;
    privacy_classification: string;
    code_list_binding_ref: string | null;
    idempotency_key: string;
    correlation_id: string;
    created_at: string;
    published_at: string | null;
    deprecated_at: string | null;
  }[];
  fieldBindings: {
    tenant_id: string;
    binding_id: string;
    offering_id: string;
    field_path: string;
    element_id: string;
    element_version: number;
    idempotency_key: string;
    correlation_id: string;
    created_at: string;
  }[];
  idemTenant: {
    tenant_id: string;
    principal_id: string;
    endpoint: string;
    idempotency_key: string;
    request_fingerprint: string;
    status: string;
    response_status: number | null;
    response_body: unknown;
  }[];
  idemPlatform: {
    principal_id: string;
    endpoint: string;
    idempotency_key: string;
    request_fingerprint: string;
    status: string;
    response_status: number | null;
    response_body: unknown;
  }[];
  outbox: unknown[];
  outboxPlatform: unknown[];
  tenantId: string | null;
}

export function emptyStore(): MemoryStore {
  return {
    elements: [],
    fieldBindings: [],
    idemTenant: [],
    idemPlatform: [],
    outbox: [],
    outboxPlatform: [],
    tenantId: null,
  };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function dispatch(store: MemoryStore, sql: string, params: unknown[]): QueryResult {
  const s = compact(sql);
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') return ok([]);
  if (s.includes('set_config')) {
    if (String(params[0]) === 'app.tenant_id') store.tenantId = String(params[1]);
    return ok([]);
  }

  if (s.includes('INSERT INTO sf_semantics.idempotency_record_platform')) {
    const exists = store.idemPlatform.some(
      (r) =>
        r.principal_id === String(params[0]) &&
        r.endpoint === String(params[1]) &&
        r.idempotency_key === String(params[2]),
    );
    if (exists) return ok([], 0);
    store.idemPlatform.push({
      principal_id: String(params[0]),
      endpoint: String(params[1]),
      idempotency_key: String(params[2]),
      request_fingerprint: String(params[3]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_semantics.idempotency_record (')) {
    const exists = store.idemTenant.some(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    if (exists) return ok([], 0);
    store.idemTenant.push({
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
  if (s.includes('FROM sf_semantics.idempotency_record_platform')) {
    const row = store.idemPlatform.find(
      (r) =>
        r.principal_id === String(params[0]) &&
        r.endpoint === String(params[1]) &&
        r.idempotency_key === String(params[2]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('FROM sf_semantics.idempotency_record')) {
    const row = store.idemTenant.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_semantics.idempotency_record_platform')) {
    const row = store.idemPlatform.find(
      (r) =>
        r.principal_id === String(params[3]) &&
        r.endpoint === String(params[4]) &&
        r.idempotency_key === String(params[5]),
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(params[1]);
      row.response_body = JSON.parse(String(params[2]));
    }
    return ok([], row ? 1 : 0);
  }
  if (s.includes('UPDATE sf_semantics.idempotency_record')) {
    const row = store.idemTenant.find(
      (r) =>
        r.tenant_id === String(params[3]) &&
        r.principal_id === String(params[4]) &&
        r.endpoint === String(params[5]) &&
        r.idempotency_key === String(params[6]),
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(params[1]);
      row.response_body = JSON.parse(String(params[2]));
    }
    return ok([], row ? 1 : 0);
  }
  if (s.includes('INSERT INTO sf_semantics.outbox_event_platform')) {
    store.outboxPlatform.push(params);
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_semantics.outbox_event (')) {
    store.outbox.push(params);
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_semantics.semantic_element')) {
    const exists = store.elements.some(
      (e) => e.element_id === String(params[0]) && e.version === 1,
    );
    if (exists) {
      const pgErr = new Error('duplicate key') as Error & { code: string };
      pgErr.code = '23505';
      throw pgErr;
    }
    store.elements.push({
      element_id: String(params[0]),
      version: 1,
      element_code: String(params[1]),
      lifecycle_status: 'DRAFT',
      privacy_classification: String(params[2]),
      code_list_binding_ref: (params[3] as string | null) ?? null,
      idempotency_key: String(params[4]),
      correlation_id: String(params[5]),
      created_at: String(params[6]),
      published_at: null,
      deprecated_at: null,
    });
    return ok([], 1);
  }

  if (s.includes("SET lifecycle_status = 'PUBLISHED'")) {
    const row = store.elements.find(
      (e) => e.element_id === String(params[1]) && e.version === Number(params[2]),
    );
    if (row) {
      row.lifecycle_status = 'PUBLISHED';
      row.published_at = String(params[0]);
    }
    return ok([], row ? 1 : 0);
  }

  if (s.includes("SET lifecycle_status = 'DEPRECATED'")) {
    const row = store.elements.find(
      (e) => e.element_id === String(params[1]) && e.version === Number(params[2]),
    );
    if (row) {
      row.lifecycle_status = 'DEPRECATED';
      row.deprecated_at = String(params[0]);
    }
    return ok([], row ? 1 : 0);
  }

  if (
    s.includes('FROM sf_semantics.semantic_element') &&
    s.includes('ORDER BY element_id, version DESC')
  ) {
    const seen = new Set<string>();
    const latest = store.elements
      .slice()
      .sort((a, b) => b.version - a.version)
      .filter((e) => {
        if (seen.has(e.element_id)) return false;
        seen.add(e.element_id);
        return true;
      });
    return ok(latest);
  }

  if (
    s.includes('FROM sf_semantics.semantic_element') &&
    s.includes('WHERE element_id = $1') &&
    s.includes('AND version = $2')
  ) {
    const row = store.elements.find(
      (e) => e.element_id === String(params[0]) && e.version === Number(params[1]),
    );
    return ok(row ? [row] : []);
  }

  if (
    s.includes('FROM sf_semantics.semantic_element') &&
    s.includes('WHERE element_id = $1') &&
    s.includes('ORDER BY version DESC')
  ) {
    const rows = store.elements
      .filter((e) => e.element_id === String(params[0]))
      .sort((a, b) => b.version - a.version);
    return ok(rows.slice(0, 1));
  }

  if (s.includes('INSERT INTO sf_semantics.field_binding')) {
    const exists = store.fieldBindings.some(
      (b) =>
        b.tenant_id === String(params[0]) &&
        b.offering_id === String(params[2]) &&
        b.field_path === String(params[3]),
    );
    if (exists) {
      const pgErr = new Error('duplicate key') as Error & { code: string };
      pgErr.code = '23505';
      throw pgErr;
    }
    store.fieldBindings.push({
      tenant_id: String(params[0]),
      binding_id: String(params[1]),
      offering_id: String(params[2]),
      field_path: String(params[3]),
      element_id: String(params[4]),
      element_version: Number(params[5]),
      idempotency_key: String(params[6]),
      correlation_id: String(params[7]),
      created_at: String(params[8]),
    });
    return ok([], 1);
  }

  if (s.includes('DELETE FROM sf_semantics.field_binding')) {
    const idx = store.fieldBindings.findIndex(
      (b) => b.tenant_id === String(params[0]) && b.binding_id === String(params[1]),
    );
    if (idx >= 0) {
      store.fieldBindings.splice(idx, 1);
      return ok([], 1);
    }
    return ok([], 0);
  }

  if (
    s.includes('SELECT') &&
    s.includes('FROM sf_semantics.field_binding') &&
    s.includes('WHERE tenant_id = $1 AND element_id = $2')
  ) {
    const rows = store.fieldBindings.filter(
      (b) => b.tenant_id === String(params[0]) && b.element_id === String(params[1]),
    );
    return ok(rows);
  }

  if (
    s.includes('SELECT') &&
    s.includes('FROM sf_semantics.field_binding') &&
    s.includes('WHERE tenant_id = $1') &&
    s.includes('ORDER BY offering_id, field_path')
  ) {
    const rows = store.fieldBindings.filter((b) => b.tenant_id === String(params[0]));
    return ok(rows);
  }

  if (
    s.includes('SELECT') &&
    s.includes('FROM sf_semantics.field_binding') &&
    s.includes('WHERE tenant_id = $1 AND binding_id = $2')
  ) {
    const row = store.fieldBindings.find(
      (b) => b.tenant_id === String(params[0]) && b.binding_id === String(params[1]),
    );
    return ok(row ? [row] : []);
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
