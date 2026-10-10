import type { AuthorizationPort } from '../../src/authz.js';
import type { ContextResolver } from '../../src/context.js';
import type { PortSample } from '../../src/domain/model.js';
import type { SummaryPort } from '../../src/ports/summary-port.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const ACTOR_CITIZEN = '55555555-5555-4555-8555-555555555555';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_OFFICER,
  type: RequestContext['actor']['type'] = 'OFFICER',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'OFFICER' ? ['OPS_VIEWER'] : ['CITIZEN'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '77777777-7777-4777-8777-777777777777',
    trace_id: '0123456789abcdef0123456789abcdef',
  };
}

export class ScriptedAuthorizer implements AuthorizationPort {
  readonly calls: AuthzDecisionInput[] = [];
  deniedActions = new Set<string>();
  denyAll = false;
  fail = false;
  decide(input: AuthzDecisionInput): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(input);
    if (this.fail) return Promise.reject(new Error('pdp down'));
    const deny = this.denyAll || this.deniedActions.has(input.action);
    return Promise.resolve({
      allow: !deny,
      reason_code: deny ? 'DENY' : 'ALLOW',
      policy_revision: 'rev-1',
      decision_id: '88888888-8888-4888-8888-888888888888',
    });
  }
}

export const SLA_SAMPLE: PortSample = {
  status: 'OK',
  source_observed_at: '2026-10-10T09:59:30Z',
  metrics: [
    { metric_code: 'SLA_CLOCKS', value: 12, dimensions: { clock_status: 'RUNNING' } },
    { metric_code: 'SLA_CLOCKS', value: 3, dimensions: { clock_status: 'PAUSED' } },
    { metric_code: 'SLA_CLOCKS', value: 1, dimensions: { clock_status: 'BREACHED' } },
  ],
};

export class ScriptedPort implements SummaryPort {
  calls = 0;
  contexts: TenantContext[] = [];
  next: unknown = SLA_SAMPLE;
  failWith: unknown = null;
  delayMs = 0;
  onCall: (() => void) | undefined;
  async fetchSummary(ctx: TenantContext): Promise<PortSample> {
    this.calls += 1;
    this.contexts.push(ctx);
    this.onCall?.();
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith !== null) throw this.failWith;
    return this.next as PortSample;
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export const resolveFixed =
  (holder: { ctx: TenantContext | RequestContext | null }): ContextResolver =>
  () =>
    Promise.resolve(holder.ctx);
