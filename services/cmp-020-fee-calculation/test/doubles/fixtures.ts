import { randomUUID } from 'node:crypto';
import type { AuthorizationPort } from '../../src/authz.js';
import type {
  ApplicationFeePins,
  ApplicationPinsPort,
} from '../../src/ports/application-pins-port.js';
import type { FeePolicyPort, PublishedFeePolicy } from '../../src/ports/fee-policy-port.js';
import type {
  FeeRulesEvaluation,
  FeeRulesPort,
  FeeRulesRequest,
} from '../../src/ports/fee-rules-port.js';
import type { FeeRepository } from '../../src/repo/types.js';
import type {
  ActorType,
  AuthzDecisionInput,
  AuthzDecisionOutput,
  TenantContext,
} from '../../src/types.js';

/**
 * All amounts, codes and currencies below are synthetic test data for exercising the generic
 * calculator. They are not a fee schedule and carry no statutory meaning.
 */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const APPLICATION_ID = '33333333-3333-4333-8333-333333333333';
export const APPLICATION_NO_FEE_PIN = '33333333-3333-4333-8333-333333333334';
export const TSB_ID = '88888888-8888-4888-8888-888888888888';
export const FEE_POLICY_FIXED = '44444444-4444-4444-8444-444444444441';
export const FEE_POLICY_RULES = '44444444-4444-4444-8444-444444444442';
export const RULE_VERSION = '55555555-5555-4555-8555-555555555555';
export const OTHER_RULE_VERSION = '55555555-5555-4555-8555-555555555556';
export const ACTOR_CITIZEN = '66666666-6666-4666-8666-666666666666';
export const ACTOR_OFFICER = '77777777-7777-4777-8777-777777777777';
export const CURRENCY = 'XTS';
export const HASH_POLICY_FIXED = `sha256:${'a'.repeat(64)}`;
export const HASH_POLICY_RULES = `sha256:${'b'.repeat(64)}`;
export const HASH_RULES = `sha256:${'c'.repeat(64)}`;

export function ctxFor(
  tenantId: string,
  actorId: string = ACTOR_CITIZEN,
  actorType: ActorType = 'CITIZEN',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-01',
    actor: { type: actorType, id: actorId },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: 'OTP',
    correlation_id: randomUUID(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  };
}

export class AllowAllAuthorizer implements AuthorizationPort {
  mode: 'allow' | 'deny' | 'throw' = 'allow';
  readonly calls: AuthzDecisionInput[] = [];

  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    this.calls.push(input);
    if (this.mode === 'throw') return Promise.reject(new Error('pdp down'));
    return Promise.resolve({
      allow: this.mode === 'allow',
      reason_code: this.mode === 'allow' ? 'ALLOW' : 'DENY',
      policy_revision: 'rev-test',
      decision_id: randomUUID(),
    });
  }
}

/** Records whether any port was invoked while a repository transaction was open. */
export class TxProbe {
  repo: FeeRepository | null = null;
  violations = 0;
  check(): void {
    if (this.repo?.inTransaction()) this.violations += 1;
  }
}

export class FakeApplicationPins implements ApplicationPinsPort {
  readonly byTenant = new Map<string, Map<string, ApplicationFeePins>>();
  failure: Error | null = null;
  calls = 0;

  constructor(private readonly probe: TxProbe) {
    this.set(TENANT_A, {
      application_id: APPLICATION_ID,
      tenant_service_binding_id: TSB_ID,
      rule_version_id: RULE_VERSION,
      fee_policy_version_id: FEE_POLICY_FIXED,
    });
    this.set(TENANT_A, {
      application_id: APPLICATION_NO_FEE_PIN,
      tenant_service_binding_id: TSB_ID,
      rule_version_id: RULE_VERSION,
      fee_policy_version_id: null,
    });
  }

  set(tenantId: string, pins: ApplicationFeePins): void {
    const m = this.byTenant.get(tenantId) ?? new Map<string, ApplicationFeePins>();
    m.set(pins.application_id, pins);
    this.byTenant.set(tenantId, m);
  }

  pinPolicy(feePolicyVersionId: string | null, tenantId = TENANT_A): void {
    const current = this.byTenant.get(tenantId)?.get(APPLICATION_ID);
    if (current) this.set(tenantId, { ...current, fee_policy_version_id: feePolicyVersionId });
  }

  getFeePins(ctx: TenantContext, applicationId: string): Promise<ApplicationFeePins | null> {
    this.probe.check();
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    const pins = this.byTenant.get(ctx.tenant_id)?.get(applicationId);
    return Promise.resolve(pins ? { ...pins } : null);
  }
}

export function fixedPolicy(overrides: Partial<PublishedFeePolicy> = {}): PublishedFeePolicy {
  return {
    fee_policy_version_id: FEE_POLICY_FIXED,
    tenant_id: TENANT_A,
    tenant_service_binding_id: TSB_ID,
    publication_status: 'PUBLISHED',
    content_hash: HASH_POLICY_FIXED,
    currency: CURRENCY,
    rule_version_id: null,
    waiver_policy_ref: null,
    lines: [
      {
        code: 'SYNTHETIC_LINE_A',
        basis: 'FIXED_AMOUNT',
        amount_minor: 12345,
        description_code: 'SYN_A',
      },
      { code: 'SYNTHETIC_LINE_B', basis: 'FIXED_AMOUNT', amount_minor: '678' },
    ],
    ...overrides,
  };
}

export function rulesPolicy(overrides: Partial<PublishedFeePolicy> = {}): PublishedFeePolicy {
  return {
    fee_policy_version_id: FEE_POLICY_RULES,
    tenant_id: TENANT_A,
    tenant_service_binding_id: TSB_ID,
    publication_status: 'PUBLISHED',
    content_hash: HASH_POLICY_RULES,
    currency: CURRENCY,
    rule_version_id: RULE_VERSION,
    waiver_policy_ref: 'synthetic-waiver-policy-ref',
    lines: [
      { code: 'SYNTHETIC_FIXED', basis: 'FIXED_AMOUNT', amount_minor: 500 },
      { code: 'SYNTHETIC_RULED', basis: 'RULE_OUTPUT', rule_output_key: 'line_amount_minor' },
    ],
    ...overrides,
  };
}

export class FakeFeePolicy implements FeePolicyPort {
  readonly versions = new Map<string, PublishedFeePolicy>();
  failure: Error | null = null;
  calls = 0;

  constructor(private readonly probe: TxProbe) {
    this.versions.set(FEE_POLICY_FIXED, fixedPolicy());
    this.versions.set(FEE_POLICY_RULES, rulesPolicy());
  }

  getPublishedVersion(ctx: TenantContext, id: string): Promise<PublishedFeePolicy | null> {
    this.probe.check();
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    const p = this.versions.get(id);
    if (!p || p.tenant_id !== ctx.tenant_id) return Promise.resolve(null);
    return Promise.resolve(JSON.parse(JSON.stringify(p)) as PublishedFeePolicy);
  }
}

export class FakeFeeRules implements FeeRulesPort {
  outputs: Record<string, unknown> = { line_amount_minor: 2500 };
  overrides: Partial<FeeRulesEvaluation> = {};
  failure: Error | null = null;
  readonly calls: FeeRulesRequest[] = [];

  constructor(private readonly probe: TxProbe) {}

  evaluate(_ctx: TenantContext, request: FeeRulesRequest): Promise<FeeRulesEvaluation> {
    this.probe.check();
    this.calls.push(JSON.parse(JSON.stringify(request)) as FeeRulesRequest);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve({
      evaluation_id: '12121212-1212-4212-8212-121212121212',
      rule_pack: { version_id: request.rule_version_id, content_hash: HASH_RULES },
      result_code: 'RULE_OUTPUT_PRODUCED',
      outputs: { ...this.outputs },
      decision_basis: 'DETERMINISTIC_RULES',
      ...this.overrides,
    });
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}
