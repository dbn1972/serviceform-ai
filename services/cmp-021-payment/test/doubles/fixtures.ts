import { randomUUID } from 'node:crypto';
import type { AuthorizationPort } from '../../src/authz.js';
import type { ConnectorBindingPort } from '../../src/ports/connector-binding-port.js';
import type { FeeQuotePort, FeeQuoteView } from '../../src/ports/fee-quote-port.js';
import type { ConnectorBindingView } from '../../src/domain/simulation.js';
import type { PaymentRepository } from '../../src/repo/types.js';
import type {
  ActorType,
  AuthzDecisionInput,
  AuthzDecisionOutput,
  TenantContext,
  DeploymentEnvironment,
} from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const APPLICATION_ID = '33333333-3333-4333-8333-333333333333';
export const FEE_QUOTE_ID = '44444444-4444-4444-8444-444444444444';
export const BINDING_ID = '55555555-5555-4555-8555-555555555555';
export const ACTOR_CITIZEN = '66666666-6666-4666-8666-666666666666';
export const ACTOR_INTEGRATION = '77777777-7777-4777-8777-777777777777';
export const CURRENCY = 'XTS';
export const AMOUNT_MINOR = 10000;
export const TEST_RUN_ID = 'test-run-001';

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

export function simulatedBinding(
  overrides: Partial<ConnectorBindingView> = {},
): ConnectorBindingView {
  return {
    connector_binding_id: BINDING_ID,
    tenant_id: null,
    connector_type: 'PAYMENT',
    mode: 'SIMULATED',
    environment: 'LOCAL',
    critical: false,
    secret_ref: null,
    simulator_version: '1.0.0',
    ...overrides,
  };
}

export function feeQuoteFixture(overrides: Partial<FeeQuoteView> = {}): FeeQuoteView {
  return {
    quote_id: FEE_QUOTE_ID,
    tenant_id: TENANT_A,
    application_id: APPLICATION_ID,
    currency: CURRENCY,
    total_amount_minor: AMOUNT_MINOR,
    client_authoritative_amount: false,
    ...overrides,
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
  repo: PaymentRepository | null = null;
  violations = 0;
  check(): void {
    if (this.repo?.inTransaction()) this.violations += 1;
  }
}

export class FakeFeeQuotePort implements FeeQuotePort {
  readonly quotes = new Map<string, FeeQuoteView>();
  failure: Error | null = null;
  calls = 0;
  constructor(private readonly probe: TxProbe) {
    this.quotes.set(FEE_QUOTE_ID, feeQuoteFixture());
  }
  getById(_tenantId: string, feeQuoteId: string): Promise<FeeQuoteView | null> {
    this.probe.check();
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.quotes.get(feeQuoteId) ?? null);
  }
}

export class FakeConnectorBindingPort implements ConnectorBindingPort {
  binding: ConnectorBindingView | null;
  failure: Error | null = null;
  calls = 0;
  constructor(
    private readonly probe: TxProbe,
    env: DeploymentEnvironment = 'LOCAL',
  ) {
    this.binding = simulatedBinding({ environment: env });
  }
  resolve(_tenantId: string, _connectorBindingId: string): Promise<ConnectorBindingView | null> {
    this.probe.check();
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.binding);
  }
  resolveDefault(_tenantId: string): Promise<ConnectorBindingView | null> {
    this.probe.check();
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.binding);
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

/**
 * Join fixture tokens. Avoids gitleaks generic-api-key false positives on
 * adjacent `*key* = 'literal'` / `*key*: 'literal'` forms in test sources.
 */
export function fixtureToken(...parts: string[]): string {
  return parts.join('-');
}

/** Idempotency envelope for unit tests (no quoted key literal on the `key` field). */
export function fixtureIdem(parts: string[], fpSeed: string) {
  return {
    key: fixtureToken(...parts),
    endpoint: 'POST /v1/payment-intents',
    fingerprint: `sha256:${fpSeed.repeat(64)}`,
  };
}

export function requireDefined<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`${label} required`);
  }
  return value;
}
