import type { Pool, PoolClient, QueryResult } from 'pg';

export interface CodeSetRow {
  code_set_id: string;
  tenant_id: string;
  set_code: string;
  localization_key: string;
  status: string;
}

export interface VersionRow {
  code_set_id: string;
  version_no: number;
  status: string;
  valid_from: Date;
  jurisdiction_ref: string | null;
}

export interface ValueRow {
  code_set_id: string;
  version_no: number;
  value_id: string;
  value_code: string;
  localization_key: string;
  sort_order: number;
  parent_value_id: string | null;
}

export interface BindingRow {
  binding_id: string;
  code_set_id: string;
  pinned_version_no: number;
  target_type: string;
  target_ref: string;
  version_no: number;
}

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
  sets: CodeSetRow[];
  versions: VersionRow[];
  values: ValueRow[];
  bindings: BindingRow[];
  imports: unknown[];
  idem: IdemRow[];
  outbox: unknown[];
}

export function emptyStore(): MemoryStore {
  return {
    sets: [],
    versions: [],
    values: [],
    bindings: [],
    imports: [],
    idem: [],
    outbox: [],
  };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function parseJson(raw: unknown): unknown {
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
  if (s.includes('pg_advisory_xact_lock')) return ok([]);

  if (s.includes('INSERT INTO sf_master_data.idempotency_record')) {
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
  if (s.includes('FROM sf_master_data.idempotency_record')) {
    const row = store.idem.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_master_data.idempotency_record')) {
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
      row.response_body = parseJson(params[2]);
    }
    return ok([]);
  }

  if (
    (s.includes('INSERT INTO sf_master_data.code_set ') ||
      s.includes('INSERT INTO sf_master_data.code_set(')) &&
    !s.includes('code_set_version') &&
    !s.includes('code_set_binding')
  ) {
    store.sets.push({
      tenant_id: String(params[0]),
      code_set_id: String(params[1]),
      set_code: String(params[2]),
      localization_key: String(params[3]),
      status: 'ACTIVE',
    });
    return ok([], 1);
  }
  if (
    s.includes('FROM sf_master_data.code_set WHERE code_set_id = $1') &&
    !s.includes('code_set_version')
  ) {
    const row = store.sets.find((r) => r.code_set_id === String(params[0]));
    return ok(row ? [row] : [], row ? 1 : 0);
  }
  if (s.includes('FROM sf_master_data.code_set') && !s.includes('code_set_version')) {
    const after = params[0] == null ? null : String(params[0]);
    const limit = Number(params[1]);
    const rows = store.sets
      .filter((r) => after === null || r.code_set_id > after)
      .sort((a, b) => a.code_set_id.localeCompare(b.code_set_id))
      .slice(0, limit);
    return ok(rows);
  }

  if (s.includes('INSERT INTO sf_master_data.code_set_version')) {
    store.versions.push({
      code_set_id: String(params[1]),
      version_no: Number(params[2]),
      status: 'DRAFT',
      valid_from: new Date(String(params[3])),
      jurisdiction_ref: params[4] == null ? null : String(params[4]),
    });
    return ok([], 1);
  }
  if (s.includes("status = 'PUBLISHED' AND valid_from")) {
    const asOf = new Date(String(params[1])).getTime();
    const rows = store.versions
      .filter(
        (v) =>
          v.code_set_id === String(params[0]) &&
          v.status === 'PUBLISHED' &&
          v.valid_from.getTime() <= asOf,
      )
      .sort(
        (a, b) => b.valid_from.getTime() - a.valid_from.getTime() || b.version_no - a.version_no,
      );
    const top = rows[0];
    return ok(top ? [{ version_no: String(top.version_no), status: top.status }] : []);
  }
  if (s.includes('SELECT version_no, status, valid_from, jurisdiction_ref')) {
    const rows = store.versions
      .filter((v) => v.code_set_id === String(params[0]))
      .sort((a, b) => a.version_no - b.version_no)
      .map((v) => ({
        version_no: String(v.version_no),
        status: v.status,
        valid_from: v.valid_from,
        jurisdiction_ref: v.jurisdiction_ref,
      }));
    return ok(rows);
  }
  if (
    s.includes('FROM sf_master_data.code_set_version') &&
    s.includes('ORDER BY version_no DESC')
  ) {
    const rows = store.versions
      .filter((v) => v.code_set_id === String(params[0]))
      .sort((a, b) => b.version_no - a.version_no);
    const top = rows[0];
    return ok(top ? [{ version_no: String(top.version_no) }] : []);
  }
  if (s.includes('FROM sf_master_data.code_set_version')) {
    const row = store.versions.find(
      (v) => v.code_set_id === String(params[0]) && v.version_no === Number(params[1]),
    );
    return ok(row ? [{ status: row.status }] : [], row ? 1 : 0);
  }
  if (s.includes("SET status = 'PUBLISHED'")) {
    const row = store.versions.find(
      (v) =>
        v.code_set_id === String(params[1]) &&
        v.version_no === Number(params[2]) &&
        v.status === 'DRAFT',
    );
    if (row) {
      row.status = 'PUBLISHED';
      if (params[0] != null) {
        /* reason stored only in SQL; not needed for unit */
      }
    }
    return ok([], row ? 1 : 0);
  }

  if (s.includes('INSERT INTO sf_master_data.code_value')) {
    store.values.push({
      code_set_id: String(params[1]),
      version_no: Number(params[2]),
      value_id: String(params[3]),
      value_code: String(params[4]),
      localization_key: String(params[5]),
      sort_order: Number(params[6]),
      parent_value_id: params[7] == null ? null : String(params[7]),
    });
    return ok([], 1);
  }
  if (s.includes('FROM sf_master_data.code_value')) {
    const codeFilter = params[2] == null ? null : String(params[2]);
    const rows = store.values
      .filter(
        (v) =>
          v.code_set_id === String(params[0]) &&
          v.version_no === Number(params[1]) &&
          (codeFilter === null || v.value_code === codeFilter),
      )
      .sort((a, b) => a.sort_order - b.sort_order || a.value_code.localeCompare(b.value_code));
    return ok(rows);
  }

  if (s.includes('INSERT INTO sf_master_data.import_job')) {
    store.imports.push(params);
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_master_data.code_set_binding')) {
    store.bindings.push({
      binding_id: String(params[0]),
      code_set_id: String(params[2]),
      pinned_version_no: Number(params[3]),
      target_type: String(params[4]),
      target_ref: String(params[5]),
      version_no: Number(params[7]),
    });
    return ok([], 1);
  }
  if (s.includes('FROM sf_master_data.code_set_binding')) {
    const rows = store.bindings
      .filter((b) => b.target_type === String(params[0]) && b.target_ref === String(params[1]))
      .sort((a, b) => b.version_no - a.version_no);
    const top = rows[0];
    return ok(top ? [{ version_no: String(top.version_no) }] : []);
  }
  if (s.includes('INSERT INTO sf_master_data.outbox_event')) {
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
