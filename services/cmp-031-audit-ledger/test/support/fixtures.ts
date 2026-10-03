import type { AuditEvent, EventEnvelope, RequestContext } from '@serviceform/contracts';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const ACTOR = '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42';
export const CORR = '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const AUDIT_ID = 'c06d4ebf-17d3-4a5f-a8c0-f3be9fd17c4c';
export const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export function allowAuthz() {
  return {
    async decide() {
      return {
        allow: true,
        reason_code: 'ALLOW',
        policy_revision: 'unit',
        decision_id: '00000000-0000-4000-8000-000000000001',
      };
    },
  };
}

export function systemCtx(tenant: string | null): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'SYSTEM', id: ACTOR },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id: CORR,
    trace_id: TRACE,
  };
}

export function sampleEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    audit_id: AUDIT_ID,
    occurred_at: '2026-10-03T09:00:00Z',
    tenant_id: T1,
    cell_id: 'cell-01',
    actor_type: 'SYSTEM',
    actor_id: ACTOR,
    action: 'EXAMPLE_WRITE',
    action_class: 'WRITE',
    resource_type: 'ExampleAggregate',
    resource_id: 'res-1',
    correlation_id: CORR,
    trace_id: TRACE,
    result: 'SUCCESS',
    classification: 'TENANT_SCOPED',
    ...over,
  };
}

export function submittedEnvelope(
  event: AuditEvent = sampleEvent(),
  over: Partial<EventEnvelope<AuditEvent>> = {},
): EventEnvelope<AuditEvent> {
  return {
    event_id: EVENT_ID,
    event_type: 'AuditEventSubmitted',
    schema_version: 1,
    tenant_id: event.tenant_id,
    cell_id: event.cell_id,
    aggregate_type: 'AuditEvent',
    aggregate_id: event.audit_id,
    aggregate_version: 0,
    occurred_at: event.occurred_at,
    correlation_id: event.correlation_id,
    actor: { type: event.actor_type, id: event.actor_id },
    data: event,
    ...over,
  };
}
