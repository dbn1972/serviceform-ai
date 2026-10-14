import { randomUUID } from 'node:crypto';
import type { AuthorizationPort } from '../../src/authz.js';
import type { ConnectorBindingPort } from '../../src/ports/connector-binding-port.js';
import type { ConnectorBindingView } from '../../src/domain/simulation.js';
import type {
  ActorType,
  AuthzDecisionInput,
  AuthzDecisionOutput,
  TenantContext,
  DeploymentEnvironment,
} from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const CREDENTIAL_ID = '33333333-3333-4333-8333-333333333333';
export const CONSENT_REF = '44444444-4444-4444-8444-444444444444';
export const BINDING_ID = '55555555-5555-4555-8555-555555555555';
export const ACTOR_SYSTEM = '66666666-6666-4666-8666-666666666666';
export const ACTOR_OFFICER = '77777777-7777-4777-8777-777777777777';
export const PURPOSE_CODE = 'DL_IDENTITY_VERIFY';
export const DOCUMENT_TYPE_REF = 'IN.GOV.AADHAAR';
export const TEST_RUN_ID = 'test-run-001';

export function ctxFor(
  tenantId: string,
  actorId: string = ACTOR_SYSTEM,
  actorType: ActorType = 'SYSTEM',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-01',
    actor: { type: actorType, id: actorId },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
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
    connector_type: 'DIGILOCKER',
    mode: 'SIMULATED',
    environment: 'LOCAL',
    critical: false,
    secret_ref: null,
    simulator_version: '1.0.0',
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

export class FakeConnectorBindingPort implements ConnectorBindingPort {
  binding: ConnectorBindingView | null;
  failure: Error | null = null;
  calls = 0;
  constructor(env: DeploymentEnvironment = 'LOCAL') {
    this.binding = simulatedBinding({ environment: env });
  }
  resolve(_tenantId: string, _connectorBindingId: string): Promise<ConnectorBindingView | null> {
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.binding);
  }
  resolveDefault(_tenantId: string): Promise<ConnectorBindingView | null> {
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

export function fixtureToken(...parts: string[]): string {
  return parts.join('-');
}

export function fixtureIdem(parts: string[], fpSeed: string) {
  return {
    key: fixtureToken(...parts),
    endpoint: 'POST /v1/digilocker-publish',
    fingerprint: `sha256:${fpSeed.repeat(64)}`,
  };
}

export function requireDefined<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`${label} required`);
  }
  return value;
}
