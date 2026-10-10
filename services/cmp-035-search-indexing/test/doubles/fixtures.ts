import { randomUUID } from 'node:crypto';
import type { ProjectionRule } from '../../src/domain/projection.js';
import type { ActorType, EventEnvelope, TenantRequestContext } from '../../src/domain/validate.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const OFFICER = '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f';
export const INDEXER = '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e';
export const SOURCE_ACTOR = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const JUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SOURCE_TOPIC = 'sf.case.events.v1';
export const SOURCE_AGGREGATE = 'ApplicationCase';
export const FIXED_NOW = new Date('2026-10-10T02:00:00.000Z');

export function ctx(
  tenant: string,
  type: ActorType = 'OFFICER',
  id: string = OFFICER,
  extra: Partial<TenantRequestContext> = {},
): TenantRequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type, id },
    organisation_id: ORG,
    roles: ['CASE_OFFICER'],
    jurisdiction_ids: [JUR],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...extra,
  };
}

export const RULE: ProjectionRule = {
  rule_id: '35353535-3535-4535-8535-353535353535',
  rule_version: 3,
  status: 'PUBLISHED',
  source_cmp_id: 'CMP-015',
  topic: SOURCE_TOPIC,
  aggregate_type: SOURCE_AGGREGATE,
  upsert_event_types: ['CaseSubmitted', 'CaseStateChanged'],
  remove_event_types: ['CaseWithdrawn'],
  facets: [
    { name: 'service_code', path: 'service_code', required: true },
    { name: 'state', path: 'state', required: true },
    { name: 'office_code', path: 'routing.office_code', required: false },
  ],
};

export function sourceEvent(params: {
  tenant: string | null;
  eventType?: string;
  aggregateId?: string;
  version?: number;
  data?: Record<string, unknown>;
  aggregateType?: string;
}): EventEnvelope {
  return {
    event_id: randomUUID(),
    event_type: params.eventType ?? 'CaseSubmitted',
    schema_version: 1,
    tenant_id: params.tenant,
    cell_id: 'cell-01',
    aggregate_type: params.aggregateType ?? SOURCE_AGGREGATE,
    aggregate_id: params.aggregateId ?? randomUUID(),
    aggregate_version: params.version ?? 1,
    occurred_at: '2026-10-10T01:59:00.000Z',
    correlation_id: randomUUID(),
    actor: { type: 'CITIZEN', id: SOURCE_ACTOR },
    data: params.data ?? {
      service_code: 'GENERIC_CERTIFICATE',
      state: 'SUBMITTED',
      routing: { office_code: 'OFFICE_A' },
      applicant_name: 'must-never-be-indexed',
    },
  };
}
