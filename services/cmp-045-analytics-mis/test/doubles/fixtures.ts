import type { AuthorizationPort } from '../../src/authz.js';
import type { EventReplayPort, ReplayBatch, ReplayRequest } from '../../src/ports/replay-port.js';
import type { AuthzDecisionInput, EventEnvelope, RequestContext } from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const CONSUMER_ACTOR = '55555555-5555-4555-8555-555555555555';
export const PURPOSE = 'OPERATIONS_MIS';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_OFFICER,
  type: RequestContext['actor']['type'] = 'OFFICER',
): RequestContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: ['MIS_ANALYST'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '77777777-7777-4777-8777-777777777777',
    trace_id: '0123456789abcdef0123456789abcdef',
  };
}

export class AllowAllAuthorizer implements AuthorizationPort {
  readonly calls: AuthzDecisionInput[] = [];
  deny = false;
  fail = false;
  decide(input: AuthzDecisionInput): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(input);
    if (this.fail) return Promise.reject(new Error('pdp down'));
    return Promise.resolve({
      allow: !this.deny,
      reason_code: this.deny ? 'DENY' : 'ALLOW',
      policy_revision: 'rev-1',
      decision_id: '88888888-8888-4888-8888-888888888888',
    });
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  readonly now = (): Date => new Date(this.ms);
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
}

let eventCounter = 0;
export function nextEventId(): string {
  eventCounter += 1;
  return `ee000000-0000-4000-8000-${String(eventCounter).padStart(12, '0')}`;
}

export function eventFor(
  tenantId: string,
  data: Record<string, unknown>,
  overrides: Partial<EventEnvelope<Record<string, unknown>>> = {},
): EventEnvelope<Record<string, unknown>> {
  return {
    event_id: nextEventId(),
    event_type: 'ApplicationSubmitted',
    schema_version: 1,
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    aggregate_type: 'Application',
    aggregate_id: 'aa000000-0000-4000-8000-000000000001',
    aggregate_version: 1,
    occurred_at: '2026-10-05T09:30:00.000Z',
    correlation_id: '66666666-6666-4666-8666-666666666666',
    actor: { type: 'SYSTEM', id: '44444444-4444-4444-8444-444444444444' },
    data,
    ...overrides,
  };
}

export const COUNT_DEFINITION = {
  metric_code: 'APPLICATIONS_SUBMITTED',
  publication_ref: 'pub:test:1',
  purpose_code: PURPOSE,
  source_event_type: 'ApplicationSubmitted',
  source_aggregate_type: 'Application',
  source_schema_version: 1,
  aggregation: 'COUNT',
  period_granularity: 'DAY',
  dimensions: [
    { key: 'service_code', source_field: 'service_code' },
    { key: 'channel', source_field: 'channel', allowed_values: ['WEB', 'MOBILE', 'ASSISTED'] },
  ],
  min_cohort_size: 3,
} as const;

export const SUM_DEFINITION = {
  metric_code: 'FEES_ASSESSED',
  publication_ref: 'pub:test:2',
  purpose_code: PURPOSE,
  source_event_type: 'FeeAssessed',
  source_schema_version: 1,
  aggregation: 'SUM',
  value_field: 'fee_amount',
  period_granularity: 'MONTH',
  dimensions: [{ key: 'service_code', source_field: 'service_code' }],
  min_cohort_size: 1,
} as const;

/** In-memory simulator of the CMP-038 event history (sandbox replay source). */
export class SimulatedReplaySource implements EventReplayPort {
  readonly events: EventEnvelope<Record<string, unknown>>[] = [];
  readonly requests: ReplayRequest[] = [];
  failWith: Error | null = null;
  onBatch: (() => Promise<void>) | null = null;

  add(event: EventEnvelope<Record<string, unknown>>): void {
    this.events.push(event);
  }

  async readBatch(request: ReplayRequest): Promise<ReplayBatch> {
    this.requests.push(request);
    if (this.failWith) throw this.failWith;
    if (this.onBatch) await this.onBatch();
    const start = request.cursor === null ? 0 : Number(request.cursor);
    const matching = this.events.filter(
      (e) =>
        e.event_type === request.event_type &&
        (request.aggregate_type === null || e.aggregate_type === request.aggregate_type),
    );
    const slice = matching.slice(start, start + request.limit);
    const next = start + request.limit < matching.length ? String(start + request.limit) : null;
    return { events: slice, next_cursor: next };
  }
}
