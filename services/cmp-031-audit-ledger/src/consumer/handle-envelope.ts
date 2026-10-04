import { assertEventFreeText, PiiRejectedError } from '@serviceform/audit-client';
import type { AuditEvent, EventEnvelope, RequestContext } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import type { Pool } from 'pg';
import { AuditError } from '../domain/errors.js';
import { appendLedger } from '../domain/ledger-writer.js';
import { insertInbox } from '../repo/outbox-repo.js';
import { withTenantTx } from '../repo/tx.js';

export interface HandleResult {
  status: 'stored' | 'duplicate' | 'already_applied' | 'dead_lettered';
  audit_id?: string;
  reason?: string;
}

export interface HandleOptions {
  source?: string;
  platformSources: readonly string[];
}

function asEvent(data: unknown): AuditEvent {
  const check = validate('audit-event', data);
  if (!check.valid) {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'INVALID_EVENT' }],
    });
  }
  return data as AuditEvent;
}

export async function handleEnvelope<T extends object>(
  pool: Pool,
  envelope: EventEnvelope<T>,
  opts: HandleOptions,
): Promise<HandleResult> {
  const envCheck = validate('event-envelope', envelope);
  if (!envCheck.valid) {
    return { status: 'dead_lettered', reason: 'INVALID_ENVELOPE' };
  }
  if (envelope.event_type !== 'AuditEventSubmitted') {
    return { status: 'dead_lettered', reason: 'EVENT_TYPE' };
  }
  if (envelope.schema_version !== 1) {
    return { status: 'dead_lettered', reason: 'SCHEMA_VERSION' };
  }
  if (envelope.aggregate_type !== 'AuditEvent') {
    return { status: 'dead_lettered', reason: 'AGGREGATE_TYPE' };
  }
  let event: AuditEvent;
  try {
    event = asEvent(envelope.data);
  } catch {
    return { status: 'dead_lettered', reason: 'INVALID_EVENT' };
  }
  if (event.audit_id !== envelope.aggregate_id) {
    return { status: 'dead_lettered', reason: 'AGGREGATE_ID' };
  }
  if (event.tenant_id !== envelope.tenant_id) {
    return { status: 'dead_lettered', reason: 'TENANT_MISMATCH' };
  }
  if (event.correlation_id !== envelope.correlation_id) {
    return { status: 'dead_lettered', reason: 'CORRELATION_MISMATCH' };
  }
  if (envelope.tenant_id === null) {
    const source = opts.source ?? '';
    if (!opts.platformSources.includes(source)) {
      return { status: 'dead_lettered', reason: 'PLATFORM_SOURCE' };
    }
  }
  try {
    assertEventFreeText(event);
  } catch (err) {
    if (err instanceof PiiRejectedError) {
      return { status: 'dead_lettered', reason: 'PII_FIELD_REJECTED' };
    }
    throw err;
  }
  const ctx: RequestContext = {
    tenant_id: envelope.tenant_id,
    cell_id: envelope.cell_id,
    actor: envelope.actor,
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id: envelope.correlation_id,
    trace_id: event.trace_id,
  };
  return withTenantTx(pool, ctx, async (client) => {
    const inserted = await insertInbox(client, envelope.event_id, envelope.tenant_id);
    if (!inserted) return { status: 'already_applied' as const, audit_id: event.audit_id };
    const result = await appendLedger(client, ctx, event);
    return {
      status: result.duplicate ? ('duplicate' as const) : ('stored' as const),
      audit_id: result.audit_id,
    };
  });
}
