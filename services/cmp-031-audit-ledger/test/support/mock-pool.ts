import { GENESIS_HASH_HEX } from '@serviceform/audit-client';
import type { AuditEvent } from '@serviceform/contracts';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const ZERO = Buffer.from(GENESIS_HASH_HEX, 'hex');

export interface StoredLedgerRow {
  tenant_id: string | null;
  chain_seq: string;
  recorded_at: Date;
  audit_id: string;
  record: AuditEvent;
  prev_hash: Buffer;
  row_hash: Buffer;
}

export interface StoredKey {
  chain_seq: string;
  recorded_at: Date;
  content_hash: Buffer;
}

export interface StoredHead {
  last_seq: string;
  last_hash: Buffer;
  last_recorded_at: Date;
}

export interface LedgerMockState {
  tenantKeys: Map<string, StoredKey>;
  platformKeys: Map<string, StoredKey>;
  tenantHeads: Map<string, StoredHead>;
  platformHead: StoredHead | undefined;
  tenantEvents: StoredLedgerRow[];
  platformEvents: StoredLedgerRow[];
  inbox: Set<string>;
  platformInbox: Set<string>;
  outbox: unknown[];
  platformOutbox: unknown[];
  recordedAt: Date;
  injectTenantKeyAfterLock?: { tenantId: string; auditId: string; key: StoredKey };
  injectPlatformKeyAfterLock?: { auditId: string; key: StoredKey };
  skipCreateTenantHead?: boolean;
  missingClock?: boolean;
  rollbackError?: Error;
  failSql?: (sql: string) => Error | undefined;
  connectError?: Error;
}

export function createLedgerState(over: Partial<LedgerMockState> = {}): LedgerMockState {
  return {
    tenantKeys: new Map(),
    platformKeys: new Map(),
    tenantHeads: new Map(),
    platformHead: {
      last_seq: '0',
      last_hash: ZERO,
      last_recorded_at: new Date('1970-01-01T00:00:00.000Z'),
    },
    tenantEvents: [],
    platformEvents: [],
    inbox: new Set(),
    platformInbox: new Set(),
    outbox: [],
    platformOutbox: [],
    recordedAt: new Date('2026-10-03T12:00:00.000Z'),
    ...over,
  };
}

function result<T extends QueryResultRow>(
  rows: T[],
  command = 'SELECT',
  rowCount = rows.length,
): QueryResult<T> {
  return { rows, command, oid: 0, fields: [], rowCount };
}

function keyOf(tenantId: string, auditId: string): string {
  return `${tenantId}:${auditId}`;
}

function dispatch(state: LedgerMockState, sql: string, params: unknown[]): QueryResult {
  const text = sql.replace(/\s+/g, ' ').trim();
  const failed = state.failSql?.(text);
  if (failed) throw failed;

  if (text === 'BEGIN' || text === 'COMMIT') return result([], text);
  if (text === 'ROLLBACK') {
    if (state.rollbackError) throw state.rollbackError;
    return result([], 'ROLLBACK');
  }
  if (text.includes('set_config')) return result([{ set_config: params[1] }]);

  if (text.includes('inbox_event_platform')) {
    const eventId = String(params[0]);
    if (state.platformInbox.has(eventId)) return result([], 'INSERT', 0);
    state.platformInbox.add(eventId);
    return result([], 'INSERT', 1);
  }
  if (text.includes('inbox_event')) {
    const eventId = String(params[0]);
    if (state.inbox.has(eventId)) return result([], 'INSERT', 0);
    state.inbox.add(eventId);
    return result([], 'INSERT', 1);
  }

  if (text.includes('INSERT INTO sf_audit.outbox_event_platform')) {
    state.platformOutbox.push(params);
    return result([], 'INSERT', 1);
  }
  if (text.includes('INSERT INTO sf_audit.outbox_event')) {
    state.outbox.push(params);
    return result([], 'INSERT', 1);
  }

  if (text.includes('INSERT INTO sf_audit.audit_chain_head ')) {
    const tenantId = String(params[0]);
    if (!state.skipCreateTenantHead && !state.tenantHeads.has(tenantId)) {
      state.tenantHeads.set(tenantId, {
        last_seq: '0',
        last_hash: ZERO,
        last_recorded_at: new Date('1970-01-01T00:00:00.000Z'),
      });
    }
    return result([], 'INSERT', 1);
  }

  if (
    text.includes('audit_chain_head_platform') &&
    text.startsWith('SELECT') &&
    text.includes('FOR UPDATE')
  ) {
    const row = state.platformHead;
    if (state.injectPlatformKeyAfterLock) {
      state.platformKeys.set(
        state.injectPlatformKeyAfterLock.auditId,
        state.injectPlatformKeyAfterLock.key,
      );
    }
    return result(row ? [row] : []);
  }
  if (text.includes('audit_chain_head_platform') && text.startsWith('UPDATE')) {
    if (state.platformHead) {
      state.platformHead = {
        last_seq: String(params[0]),
        last_hash: params[1] as Buffer,
        last_recorded_at: params[2] as Date,
      };
    }
    return result([], 'UPDATE', 1);
  }
  if (text.includes('audit_chain_head_platform') && text.startsWith('SELECT')) {
    return result(state.platformHead ? [state.platformHead] : []);
  }

  if (text.includes('FROM sf_audit.audit_chain_head') && text.includes('FOR UPDATE')) {
    const tenantId = String(params[0]);
    if (state.injectTenantKeyAfterLock && state.injectTenantKeyAfterLock.tenantId === tenantId) {
      state.tenantKeys.set(
        keyOf(tenantId, state.injectTenantKeyAfterLock.auditId),
        state.injectTenantKeyAfterLock.key,
      );
    }
    const row = state.tenantHeads.get(tenantId);
    return result(row ? [row] : []);
  }
  if (text.startsWith('UPDATE sf_audit.audit_chain_head')) {
    const tenantId = String(params[0]);
    state.tenantHeads.set(tenantId, {
      last_seq: String(params[1]),
      last_hash: params[2] as Buffer,
      last_recorded_at: params[3] as Date,
    });
    return result([], 'UPDATE', 1);
  }
  if (text.includes('FROM sf_audit.audit_chain_head')) {
    const tenantId = String(params[0]);
    const row = state.tenantHeads.get(tenantId);
    return result(row ? [row] : []);
  }

  if (text.includes('audit_event_platform_key') && text.startsWith('SELECT')) {
    const row = state.platformKeys.get(String(params[0]));
    return result(row ? [row] : []);
  }
  if (text.includes('INSERT INTO sf_audit.audit_event_platform_key')) {
    state.platformKeys.set(String(params[0]), {
      chain_seq: String(params[1]),
      recorded_at: params[2] as Date,
      content_hash: params[3] as Buffer,
    });
    return result([], 'INSERT', 1);
  }

  if (text.includes('FROM sf_audit.audit_event_key') && text.startsWith('SELECT')) {
    const row = state.tenantKeys.get(keyOf(String(params[0]), String(params[1])));
    return result(row ? [row] : []);
  }
  if (text.includes('INSERT INTO sf_audit.audit_event_key')) {
    state.tenantKeys.set(keyOf(String(params[0]), String(params[1])), {
      chain_seq: String(params[2]),
      recorded_at: params[3] as Date,
      content_hash: params[4] as Buffer,
    });
    return result([], 'INSERT', 1);
  }

  if (text.includes('INSERT INTO sf_audit.audit_event_platform')) {
    const record = JSON.parse(String(params[3])) as AuditEvent;
    state.platformEvents.push({
      tenant_id: null,
      chain_seq: String(params[0]),
      recorded_at: params[1] as Date,
      audit_id: String(params[2]),
      record,
      prev_hash: params[4] as Buffer,
      row_hash: params[5] as Buffer,
    });
    return result([], 'INSERT', 1);
  }
  if (text.includes('INSERT INTO sf_audit.audit_event')) {
    const record = JSON.parse(String(params[4])) as AuditEvent;
    state.tenantEvents.push({
      tenant_id: String(params[0]),
      chain_seq: String(params[1]),
      recorded_at: params[2] as Date,
      audit_id: String(params[3]),
      record,
      prev_hash: params[5] as Buffer,
      row_hash: params[6] as Buffer,
    });
    return result([], 'INSERT', 1);
  }

  if (text.includes('date_trunc')) {
    if (state.missingClock) return result([]);
    return result([{ recorded_at: state.recordedAt }]);
  }

  if (text.includes('FROM sf_audit.audit_event_platform e')) {
    return result(state.platformEvents);
  }
  if (text.includes('FROM sf_audit.audit_event e')) {
    const tenantId = String(params[0]);
    return result(state.tenantEvents.filter((row) => row.tenant_id === tenantId));
  }

  if (text.includes('FROM sf_audit.audit_event') && text.includes('WHERE')) {
    const tenantId = String(params[0]);
    const from = params[1] as Date;
    const to = params[2] as Date;
    const limit = Number(params[params.length - 1]);
    const matched = state.tenantEvents.filter((row) => {
      if (row.tenant_id !== tenantId) return false;
      if (row.recorded_at < from || row.recorded_at > to) return false;
      return true;
    });
    return result(matched.slice(0, limit));
  }

  throw new Error(`unmocked sql: ${text}`);
}

function bindClient(state: LedgerMockState): PoolClient {
  return {
    query: async (sql: string | { text: string }, params: unknown[] = []) => {
      const text = typeof sql === 'string' ? sql : sql.text;
      return dispatch(state, text, params);
    },
    release: () => undefined,
  } as unknown as PoolClient;
}

export function createMockClient(state: LedgerMockState): PoolClient {
  return bindClient(state);
}

export function createMockPool(state: LedgerMockState): Pool {
  return {
    connect: async () => {
      if (state.connectError) throw state.connectError;
      return bindClient(state);
    },
  } as unknown as Pool;
}
