import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResult } from 'pg';

export interface ProfileRow {
  tenant_id: string;
  profile_id: string;
  subject_id: string;
  status: string;
  version: string;
}

export interface ClaimRow {
  tenant_id: string;
  claim_id: string;
  profile_id: string;
  subject_id: string;
  section_code: string;
  claim_code: string;
  value_sha256: string;
  value_text: string;
  source_kind: string;
  connector_type: string | null;
  verification_status: string;
  purpose_code: string;
  source_ref: string | null;
  verified_at: Date | null;
  expires_at: Date | null;
  simulation: unknown;
  version: string;
}

export interface IdemRow {
  tenant_id: string | null;
  principal_id: string;
  endpoint: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
}

export interface MemoryStore {
  definitions: { section_code: string; claim_code: string }[];
  profiles: ProfileRow[];
  claims: ClaimRow[];
  idemTenant: IdemRow[];
  idemPlatform: IdemRow[];
  outbox: unknown[];
  outboxPlatform: unknown[];
  setConfigs: { key: string; value: string }[];
  released: number;
  rollbackThrows: boolean;
  failQuery?: (sql: string) => unknown;
}

export function emptyStore(): MemoryStore {
  return {
    definitions: [
      { section_code: 'IDENTITY', claim_code: 'DISPLAY_NAME' },
      { section_code: 'ADDRESS', claim_code: 'LOCALITY' },
      { section_code: 'FAMILY', claim_code: 'MEMBER_DISPLAY_NAME' },
      { section_code: 'OCCUPATION', claim_code: 'OCCUPATION_TITLE' },
      { section_code: 'IDENTITY', claim_code: 'GIVEN_NAME' },
    ],
    profiles: [],
    claims: [],
    idemTenant: [],
    idemPlatform: [],
    outbox: [],
    outboxPlatform: [],
    setConfigs: [],
    released: 0,
    rollbackThrows: false,
  };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function dispatch(store: MemoryStore, sql: string, params: unknown[]): QueryResult {
  const injected = store.failQuery?.(sql);
  if (injected) throw injected;
  const s = compact(sql);
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT') return ok([]);
  if (upper === 'ROLLBACK') {
    if (store.rollbackThrows) throw new Error('rollback-failed');
    return ok([]);
  }
  if (s.includes('set_config')) {
    store.setConfigs.push({ key: String(params[0]), value: String(params[1]) });
    return ok([]);
  }

  if (s.includes('INSERT INTO sf_citizen_profile.idempotency_record_platform')) {
    const exists = store.idemPlatform.some(
      (r) =>
        r.principal_id === String(params[0]) &&
        r.endpoint === String(params[1]) &&
        r.idempotency_key === String(params[2]),
    );
    if (exists) return ok([], 0);
    store.idemPlatform.push({
      tenant_id: null,
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
  if (s.includes('INSERT INTO sf_citizen_profile.idempotency_record (')) {
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
  if (s.includes('FROM sf_citizen_profile.idempotency_record_platform')) {
    const row = store.idemPlatform.find(
      (r) =>
        r.principal_id === String(params[0]) &&
        r.endpoint === String(params[1]) &&
        r.idempotency_key === String(params[2]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('FROM sf_citizen_profile.idempotency_record')) {
    const row = store.idemTenant.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_citizen_profile.idempotency_record_platform')) {
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
  if (s.includes('UPDATE sf_citizen_profile.idempotency_record')) {
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
  if (s.includes('INSERT INTO sf_citizen_profile.outbox_event_platform')) {
    store.outboxPlatform.push(params);
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_citizen_profile.outbox_event (')) {
    store.outbox.push(params);
    return ok([], 1);
  }
  if (s.includes('FROM sf_citizen_profile.claim_definition')) {
    const found = store.definitions.some(
      (d) => d.section_code === String(params[0]) && d.claim_code === String(params[1]),
    );
    return ok(found ? [{ ok: 1 }] : [], found ? 1 : 0);
  }
  if (s.includes('INSERT INTO sf_citizen_profile.citizen_profile')) {
    const tenant_id = String(params[0]);
    const subject_id = String(params[2]);
    if (store.profiles.some((p) => p.tenant_id === tenant_id && p.subject_id === subject_id)) {
      return ok([], 0);
    }
    const row: ProfileRow = {
      tenant_id,
      profile_id: String(params[1]),
      subject_id,
      status: 'ACTIVE',
      version: '1',
    };
    store.profiles.push(row);
    return ok([row], 1);
  }
  if (s.includes('FROM sf_citizen_profile.citizen_profile')) {
    const row = store.profiles.find(
      (p) => p.tenant_id === String(params[0]) && p.subject_id === String(params[1]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('INSERT INTO sf_citizen_profile.profile_claim')) {
    const row: ClaimRow = {
      tenant_id: String(params[0]),
      claim_id: String(params[1]),
      profile_id: String(params[2]),
      subject_id: String(params[3]),
      section_code: String(params[4]),
      claim_code: String(params[5]),
      value_sha256: String(params[6]),
      value_text: String(params[7]),
      source_kind: String(params[8]),
      connector_type: (params[9] as string | null) ?? null,
      verification_status: String(params[10]),
      purpose_code: String(params[11]),
      source_ref: (params[12] as string | null) ?? null,
      verified_at: params[13] ? new Date(String(params[13])) : null,
      expires_at: null,
      simulation: params[14] ? JSON.parse(String(params[14])) : null,
      version: '1',
    };
    store.claims.push(row);
    return ok([row], 1);
  }
  if (s.includes('UPDATE sf_citizen_profile.profile_claim')) {
    const row = store.claims.find(
      (c) => c.tenant_id === String(params[10]) && c.claim_id === String(params[11]),
    );
    if (!row) return ok([], 0);
    row.value_sha256 = String(params[0]);
    row.value_text = String(params[1]);
    row.source_kind = String(params[2]);
    row.connector_type = (params[3] as string | null) ?? null;
    row.verification_status = String(params[4]);
    row.purpose_code = String(params[5]);
    row.source_ref = (params[6] as string | null) ?? null;
    row.verified_at = params[7] ? new Date(String(params[7])) : null;
    row.simulation = params[8] ? JSON.parse(String(params[8])) : null;
    row.version = String(Number(row.version) + 1);
    return ok([row], 1);
  }
  if (s.includes('FROM sf_citizen_profile.profile_claim') && s.includes('AND claim_code')) {
    const row = store.claims.find(
      (c) =>
        c.tenant_id === String(params[0]) &&
        c.profile_id === String(params[1]) &&
        c.section_code === String(params[2]) &&
        c.claim_code === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('FROM sf_citizen_profile.profile_claim')) {
    const rows = store.claims.filter(
      (c) => c.tenant_id === String(params[0]) && c.profile_id === String(params[1]),
    );
    return ok(rows);
  }
  throw new Error(`unhandled sql: ${s.slice(0, 180)}`);
}

export function createMemoryPool(store: MemoryStore): Pool {
  const connect = async (): Promise<PoolClient> => {
    const client = {
      query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
      release: () => {
        store.released += 1;
      },
    };
    return client as unknown as PoolClient;
  };
  return {
    connect,
    query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
  } as unknown as Pool;
}

export const BINDING = {
  connector_binding_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  connector_type: 'DIGILOCKER' as const,
  mode: 'SIMULATED' as const,
  environment: 'CI' as const,
  critical: true,
  secret_ref: null,
  simulator_version: 'sim-1',
};

export const ACTOR_CITIZEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ACTOR_OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';

export function unusedUuid(): string {
  return randomUUID();
}
