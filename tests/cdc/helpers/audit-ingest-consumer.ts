import type { AuditEvent, EventEnvelope } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';

/**
 * CMP-031 consumer expectations for sf.audit.ingest.v1 (schema_version 1).
 * Bound to frozen SF-CON-EVENT-ENVELOPE + SF-CON-AUDIT-EVENT — not CMP-031 internals.
 */
export type AuditIngestRejectReason =
  | 'INVALID_ENVELOPE'
  | 'EVENT_TYPE'
  | 'SCHEMA_VERSION'
  | 'AGGREGATE_TYPE'
  | 'INVALID_EVENT'
  | 'AGGREGATE_ID'
  | 'TENANT_MISMATCH'
  | 'CORRELATION_MISMATCH';

export type AuditIngestCheck =
  { ok: true; event: AuditEvent } | { ok: false; reason: AuditIngestRejectReason };

export const AUDIT_INGEST = {
  topic: 'sf.audit.ingest.v1',
  event_type: 'AuditEventSubmitted',
  schema_version: 1,
  aggregate_type: 'AuditEvent',
} as const;

export function checkAuditIngestEnvelope(envelope: unknown): AuditIngestCheck {
  const envCheck = validate('event-envelope', envelope);
  if (!envCheck.valid) return { ok: false, reason: 'INVALID_ENVELOPE' };
  const env = envelope as EventEnvelope;
  if (env.event_type !== AUDIT_INGEST.event_type) return { ok: false, reason: 'EVENT_TYPE' };
  if (env.schema_version !== AUDIT_INGEST.schema_version)
    return { ok: false, reason: 'SCHEMA_VERSION' };
  if (env.aggregate_type !== AUDIT_INGEST.aggregate_type)
    return { ok: false, reason: 'AGGREGATE_TYPE' };
  const dataCheck = validate('audit-event', env.data);
  if (!dataCheck.valid) return { ok: false, reason: 'INVALID_EVENT' };
  const event = env.data as AuditEvent;
  if (event.audit_id !== env.aggregate_id) return { ok: false, reason: 'AGGREGATE_ID' };
  if (event.tenant_id !== env.tenant_id) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (event.correlation_id !== env.correlation_id)
    return { ok: false, reason: 'CORRELATION_MISMATCH' };
  return { ok: true, event };
}
