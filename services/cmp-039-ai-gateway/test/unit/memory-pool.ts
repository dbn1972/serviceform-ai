import type { Pool, PoolClient, QueryResult } from 'pg';
import type { RequestMetadataRow } from '../../src/repo/metadata-repo.js';
import type { ModelRow, PolicyRow } from '../../src/repo/registry-repo.js';

interface IdemRow {
  tenant_id: string;
  principal_id: string;
  endpoint: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
}

export interface OutboxCapture {
  eventType: string;
  topic: string;
  tenantId: string;
  envelope: unknown;
}

export interface MemoryStore {
  models: ModelRow[];
  policies: PolicyRow[];
  metadata: RequestMetadataRow[];
  idem: IdemRow[];
  outbox: OutboxCapture[];
  failNextMetadataInsert: boolean;
}

export function emptyStore(): MemoryStore {
  return {
    models: [],
    policies: [],
    metadata: [],
    idem: [],
    outbox: [],
    failNextMetadataInsert: false,
  };
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

function idemMatch(r: IdemRow, p: unknown[], o = 0): boolean {
  return (
    r.tenant_id === String(p[o]) &&
    r.principal_id === String(p[o + 1]) &&
    r.endpoint === String(p[o + 2]) &&
    r.idempotency_key === String(p[o + 3])
  );
}

function dispatch(store: MemoryStore, sql: string, p: unknown[]): QueryResult {
  const s = compact(sql);
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') return ok([]);
  if (s.includes('set_config')) return ok([]);

  if (s.includes('INSERT INTO sf_ai_gateway.idempotency_record')) {
    if (store.idem.some((r) => idemMatch(r, p))) return ok([], 0);
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
  if (s.includes('FROM sf_ai_gateway.idempotency_record')) {
    const row = store.idem.find((r) => idemMatch(r, p));
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_ai_gateway.idempotency_record')) {
    const row = store.idem.find((r) => idemMatch(r, p, 3));
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(p[1]);
      row.response_body = parsePayload(p[2]);
    }
    return ok([]);
  }

  if (s.includes('INSERT INTO sf_ai_gateway.model_registry')) {
    const [id, tenant, cell, provider, model, version, ops, cls, maxIn, maxOut, budget, by, at] = p;
    const dup = store.models.some(
      (m) =>
        m.tenant_id === tenant &&
        m.provider_id === provider &&
        m.model_id === model &&
        m.model_version === version &&
        m.status === 'ACTIVE',
    );
    if (dup) throw Object.assign(new Error('dup'), { code: '23505' });
    const row: ModelRow = {
      model_entry_id: String(id),
      tenant_id: String(tenant),
      cell_id: String(cell),
      provider_id: String(provider),
      model_id: String(model),
      model_version: String(version),
      operations: ops as string[],
      max_data_classification: String(cls),
      max_input_chars: Number(maxIn),
      max_output_tokens: Number(maxOut),
      daily_token_budget: Number(budget),
      status: 'ACTIVE',
      registered_by: String(by),
      revoked_by: null,
      revoke_reason: null,
      aggregate_version: 1,
      created_at: at as Date,
      revoked_at: null,
    };
    store.models.push(row);
    return ok([row], 1);
  }
  if (s.includes('UPDATE sf_ai_gateway.model_registry')) {
    const row = store.models.find(
      (m) => m.tenant_id === p[3] && m.model_entry_id === p[4] && m.status === 'ACTIVE',
    );
    if (!row) return ok([]);
    row.status = 'REVOKED';
    row.revoked_by = String(p[0]);
    row.revoke_reason = String(p[1]);
    row.revoked_at = p[2] as Date;
    return ok([row], 1);
  }
  if (s.includes('FROM sf_ai_gateway.model_registry') && s.includes('ANY($2::uuid[])')) {
    const ids = p[1] as string[];
    return ok(store.models.filter((m) => m.tenant_id === p[0] && ids.includes(m.model_entry_id)));
  }
  if (s.includes('FROM sf_ai_gateway.model_registry')) {
    return ok(store.models.filter((m) => m.tenant_id === p[0] && m.status === 'ACTIVE'));
  }

  if (s.includes('INSERT INTO sf_ai_gateway.ai_policy')) {
    const dup = store.policies.some(
      (x) => x.tenant_id === p[0] && x.policy_id === p[2] && x.policy_version === p[3],
    );
    if (dup) throw Object.assign(new Error('dup'), { code: '23505' });
    const row: PolicyRow = {
      tenant_id: String(p[0]),
      cell_id: String(p[1]),
      policy_id: String(p[2]),
      policy_version: Number(p[3]),
      task_kind: String(p[4]),
      operation: p[5] as PolicyRow['operation'],
      template_body: p[6] as string | null,
      template_hash: String(p[7]),
      variable_names: p[8] as string[],
      allowed_tools: parsePayload(p[9]) as PolicyRow['allowed_tools'],
      model_entry_ids: p[10] as string[],
      max_data_classification: String(p[11]),
      max_output_tokens: Number(p[12]),
      latency_budget_ms: Number(p[13]),
      fallback_behavior: p[14] as PolicyRow['fallback_behavior'],
      evaluation_ref: parsePayload(p[15]) as PolicyRow['evaluation_ref'],
      status: 'ACTIVE',
      registered_by: String(p[16]),
      aggregate_version: 1,
      created_at: p[17] as Date,
      retired_at: null,
    };
    store.policies.push(row);
    return ok([row], 1);
  }
  if (s.includes('UPDATE sf_ai_gateway.ai_policy')) {
    const row = store.policies.find(
      (x) =>
        x.tenant_id === p[1] &&
        x.policy_id === p[2] &&
        x.policy_version === p[3] &&
        x.status === 'ACTIVE',
    );
    if (!row) return ok([]);
    row.status = 'RETIRED';
    row.retired_at = p[0] as Date;
    return ok([row], 1);
  }
  if (s.includes('FROM sf_ai_gateway.ai_policy')) {
    return ok(
      store.policies.filter(
        (x) => x.tenant_id === p[0] && x.policy_id === p[1] && x.policy_version === p[2],
      ),
    );
  }

  if (s.includes('INSERT INTO sf_ai_gateway.ai_request_metadata')) {
    if (store.failNextMetadataInsert) {
      store.failNextMetadataInsert = false;
      throw new Error('simulated metadata failure');
    }
    store.metadata.push({
      request_id: String(p[0]),
      tenant_id: String(p[1]),
      cell_id: String(p[2]),
      actor_type: String(p[3]),
      actor_id: String(p[4]),
      correlation_id: String(p[5]),
      trace_id: String(p[6]),
      operation: p[7] as 'INVOKE' | 'EMBED',
      policy_id: String(p[8]),
      policy_version: p[9] as number | null,
      caller_component: p[10] as string | null,
      policy_hash: p[11] as string | null,
      prompt_hash: p[12] as string | null,
      provider_id: p[13] as string | null,
      model_id: p[14] as string | null,
      model_version: p[15] as string | null,
      tool_calls: parsePayload(p[16]) as RequestMetadataRow['tool_calls'],
      citations: parsePayload(p[17]) as RequestMetadataRow['citations'],
      data_classification: String(p[18]),
      purpose: String(p[19]),
      redaction_summary: parsePayload(p[20]) as Record<string, number>,
      outcome: p[21] as RequestMetadataRow['outcome'],
      reason_code: p[22] as string | null,
      fallback_used: Boolean(p[23]),
      attempts: Number(p[24]),
      input_tokens: Number(p[25]),
      output_tokens: Number(p[26]),
      latency_ms: Number(p[27]),
      simulated: Boolean(p[28]),
      created_at: p[29] as Date,
    });
    return ok([], 1);
  }
  if (s.includes('SUM(input_tokens + output_tokens)')) {
    const since = p[4] as Date;
    const total = store.metadata
      .filter(
        (m) =>
          m.tenant_id === p[0] &&
          m.provider_id === p[1] &&
          m.model_id === p[2] &&
          m.model_version === p[3] &&
          m.outcome === 'COMPLETED' &&
          m.created_at >= since,
      )
      .reduce((n, m) => n + m.input_tokens + m.output_tokens, 0);
    return ok([{ total: String(total) }]);
  }
  if (s.includes('INSERT INTO sf_ai_gateway.outbox_event')) {
    const env = parsePayload(p[p.length - 1]) as { event_type: string };
    store.outbox.push({
      eventType: env.event_type,
      topic: String(p[2]),
      tenantId: String(p[1]),
      envelope: env,
    });
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
