import type { Pool, PoolClient, QueryResult } from 'pg';
import type {
  ProjectRow,
  SourceProfileRow,
  MappingSpecRow,
  BatchRow,
  ReconciliationRow,
} from '../../src/repo/migration-repo.js';

export interface MemoryStore {
  projects: ProjectRow[];
  profiles: SourceProfileRow[];
  mappings: MappingSpecRow[];
  batches: BatchRow[];
  reconciliations: ReconciliationRow[];
  outbox: unknown[];
}

export function emptyStore(): MemoryStore {
  return {
    projects: [],
    profiles: [],
    mappings: [],
    batches: [],
    reconciliations: [],
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
  if (s.includes('set_config')) return ok([{ set_config: '' }]);

  // ── migration_project ──────────────────────────────────────────────────

  if (s.includes('INSERT INTO sf_migration.migration_project')) {
    const now = new Date(String(params[6]));
    const row: ProjectRow = {
      tenant_id: String(params[0]),
      project_id: String(params[1]),
      display_name: String(params[2]),
      source_system_ref: String(params[3]),
      target_service_code: params[4] ? String(params[4]) : null,
      status: 'DRAFT',
      dry_run_count: 0,
      last_dry_run_at: null,
      created_by: String(params[5]),
      created_at: now,
      updated_at: now,
      project_version: 1,
    };
    store.projects.push(row);
    return ok([row], 1);
  }

  if (s.includes('SELECT * FROM sf_migration.migration_project WHERE')) {
    const row = store.projects.find(
      (p) => p.tenant_id === String(params[0]) && p.project_id === String(params[1]),
    );
    return ok(row ? [row] : []);
  }

  if (s.includes('UPDATE sf_migration.migration_project')) {
    const row = store.projects.find(
      (p) => p.tenant_id === String(params[1]) && p.project_id === String(params[4]),
    );
    if (!row) return ok([]);
    row.status = String(params[0]) as ProjectRow['status'];
    row.updated_at = new Date(String(params[2]));
    row.project_version = (row.project_version ?? 1) + 1;
    if (params[3]) {
      row.dry_run_count += 1;
      row.last_dry_run_at = new Date(String(params[2]));
    }
    return ok([row], 1);
  }

  // ── source_profile ─────────────────────────────────────────────────────

  if (s.includes('INSERT INTO sf_migration.source_profile')) {
    const now = new Date(String(params[7]));
    const row: SourceProfileRow = {
      tenant_id: String(params[0]),
      profile_id: String(params[1]),
      project_id: String(params[2]),
      schema_descriptor: parseJson(params[3]),
      field_count: Number(params[4]),
      record_count_estimate: params[5] != null ? Number(params[5]) : null,
      profile_version: 1,
      created_by: String(params[6]),
      created_at: now,
    };
    store.profiles.push(row);
    return ok([row], 1);
  }

  // ── mapping_spec ───────────────────────────────────────────────────────

  if (s.includes('INSERT INTO sf_migration.mapping_spec')) {
    const now = new Date(String(params[7]));
    const row: MappingSpecRow = {
      tenant_id: String(params[0]),
      mapping_id: String(params[1]),
      project_id: String(params[2]),
      mapping_version_ref: String(params[3]),
      field_mappings: parseJson(params[4]),
      exception_policy_ref: params[5] ? String(params[5]) : null,
      created_by: String(params[6]),
      created_at: now,
    };
    store.mappings.push(row);
    return ok([row], 1);
  }

  if (s.includes('FROM sf_migration.mapping_spec')) {
    const rows = store.mappings
      .filter((m) => m.tenant_id === String(params[0]) && m.project_id === String(params[1]))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return ok(rows.slice(0, 1));
  }

  // ── migration_batch ────────────────────────────────────────────────────

  if (s.includes('INSERT INTO sf_migration.migration_batch')) {
    const now = new Date(String(params[6]));
    const row: BatchRow = {
      tenant_id: String(params[0]),
      batch_id: String(params[1]),
      project_id: String(params[2]),
      batch_type: String(params[3]) as BatchRow['batch_type'],
      status: 'PENDING',
      mapping_id: String(params[4]),
      total_records: Number(params[5]),
      processed_records: 0,
      failed_records: 0,
      exception_count: 0,
      started_at: now,
      completed_at: null,
      created_by: String(params[7]),
      created_at: now,
    };
    store.batches.push(row);
    return ok([row], 1);
  }

  if (s.includes('UPDATE sf_migration.migration_batch')) {
    const row = store.batches.find(
      (b) => b.tenant_id === String(params[5]) && b.batch_id === String(params[6]),
    );
    if (!row) return ok([]);
    row.status = String(params[0]) as BatchRow['status'];
    row.processed_records = Number(params[1]);
    row.failed_records = Number(params[2]);
    row.exception_count = Number(params[3]);
    row.completed_at = new Date(String(params[4]));
    return ok([row], 1);
  }

  if (s.includes('FROM sf_migration.migration_batch') && s.includes("batch_type = 'DRY_RUN'")) {
    const rows = store.batches
      .filter(
        (b) =>
          b.tenant_id === String(params[0]) &&
          b.project_id === String(params[1]) &&
          b.batch_type === 'DRY_RUN' &&
          b.status === 'COMPLETED',
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return ok(rows.slice(0, 1));
  }

  // ── reconciliation_result ──────────────────────────────────────────────

  if (s.includes('INSERT INTO sf_migration.reconciliation_result')) {
    const now = new Date(String(params[11]));
    const row: ReconciliationRow = {
      tenant_id: String(params[0]),
      result_id: String(params[1]),
      project_id: String(params[2]),
      batch_id: String(params[3]),
      source_count: Number(params[4]),
      target_count: Number(params[5]),
      matched_count: Number(params[6]),
      exception_list: parseJson(params[7]),
      reconciliation_status: String(params[8]) as ReconciliationRow['reconciliation_status'],
      evidence_ref: params[9] ? String(params[9]) : null,
      created_by: String(params[10]),
      created_at: now,
    };
    store.reconciliations.push(row);
    return ok([row], 1);
  }

  if (s.includes('FROM sf_migration.reconciliation_result r')) {
    const rows = store.reconciliations
      .filter((r) => r.tenant_id === String(params[0]) && r.project_id === String(params[1]))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return ok(rows.slice(0, 1));
  }

  // ── outbox ─────────────────────────────────────────────────────────────

  if (s.includes('INSERT INTO sf_migration.outbox_event')) {
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
