import { randomUUID } from 'node:crypto';
import type { AuthorizationPort } from '../../src/authz.js';
import type { CaseIssuancePins, CaseIssuancePinsPort } from '../../src/ports/case-pins-port.js';
import type {
  CredentialRegistryPort,
  RegistrationAck,
  RegistrationRequest,
} from '../../src/ports/registry-port.js';
import type {
  ArtifactRenderPort,
  RenderRequest,
  StoredArtifactRef,
} from '../../src/ports/render-port.js';
import type {
  SigningAdapterResult,
  SigningPort,
  SigningRequest,
} from '../../src/ports/signing-port.js';
import type { CredentialRepository } from '../../src/repo/types.js';
import type {
  ActorType,
  AuthzDecisionInput,
  AuthzDecisionOutput,
  TenantContext,
} from '../../src/types.js';

/**
 * Synthetic identifiers and opaque references only. No template content, signer, certificate
 * class or statutory meaning is modelled here.
 */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const APPLICATION_ID = '33333333-3333-4333-8333-333333333333';
export const APPLICATION_UNAPPROVED = '33333333-3333-4333-8333-333333333334';
export const APPLICATION_NO_TEMPLATE = '33333333-3333-4333-8333-333333333335';
export const TSB_ID = '44444444-4444-4444-8444-444444444444';
export const SERVICE_VERSION_ID = '55555555-5555-4555-8555-555555555555';
export const TEMPLATE_ID = '66666666-6666-4666-8666-666666666666';
export const ACTOR_SYSTEM = '77777777-7777-4777-8777-777777777777';
export const ACTOR_CITIZEN = '77777777-7777-4777-8777-777777777778';
export const BINDING_ID = '88888888-8888-4888-8888-888888888888';
export const APPROVAL_REF = 'wf:decision:synthetic-0001';
export const ISSUANCE_KEY = 'app-33333333:issue:1';

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
  repo: CredentialRepository | null = null;
  violations = 0;

  check(): void {
    if (this.repo?.inTransaction()) this.violations += 1;
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  readonly now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export function pins(overrides: Partial<CaseIssuancePins> = {}): CaseIssuancePins {
  return {
    application_id: APPLICATION_ID,
    tenant_service_binding_id: TSB_ID,
    service_version_id: SERVICE_VERSION_ID,
    credential_template_id: TEMPLATE_ID,
    credential_template_version: 3,
    approval_decision_ref: APPROVAL_REF,
    ...overrides,
  };
}

export class FakeCasePins implements CaseIssuancePinsPort {
  readonly byTenant = new Map<string, Map<string, CaseIssuancePins>>();
  failure: Error | null = null;
  calls = 0;

  constructor(private readonly probe: TxProbe) {
    this.set(TENANT_A, pins());
    this.set(
      TENANT_A,
      pins({ application_id: APPLICATION_UNAPPROVED, approval_decision_ref: null }),
    );
    this.set(
      TENANT_A,
      pins({
        application_id: APPLICATION_NO_TEMPLATE,
        credential_template_id: null,
        credential_template_version: null,
      }),
    );
  }

  set(tenantId: string, value: CaseIssuancePins): void {
    const m = this.byTenant.get(tenantId) ?? new Map<string, CaseIssuancePins>();
    m.set(value.application_id, value);
    this.byTenant.set(tenantId, m);
  }

  getIssuancePins(ctx: TenantContext, applicationId: string): Promise<CaseIssuancePins | null> {
    this.probe.check();
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    const value = this.byTenant.get(ctx.tenant_id)?.get(applicationId);
    return Promise.resolve(value ? { ...value } : null);
  }
}

const hex = (seed: string): string => {
  let out = '';
  for (let i = 0; out.length < 64; i += 1)
    out += ((seed.charCodeAt(i % seed.length) + i) % 16).toString(16);
  return out;
};

export class FakeRenderer implements ArtifactRenderPort {
  readonly calls: RenderRequest[] = [];
  failure: Error | null = null;
  override: Partial<StoredArtifactRef> | null = null;

  constructor(private readonly probe: TxProbe) {}

  render(ctx: TenantContext, req: RenderRequest): Promise<StoredArtifactRef> {
    this.probe.check();
    this.calls.push(req);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve({
      storage_key: `tenant/${ctx.tenant_id}/credentials/${req.credential_id}/render.pdf`,
      sha256: hex(`render:${req.idempotency_key}`),
      ...(this.override ?? {}),
    });
  }
}

export type SignerScript = (req: SigningRequest) => SigningAdapterResult | Error;

export function simulatedSigned(req: SigningRequest): SigningAdapterResult {
  return {
    connector_binding_id: BINDING_ID,
    integration_contract: 'INT-013',
    connector_mode: 'SIMULATED',
    simulation_marker: {
      simulation: true,
      scenario: 'esign_success',
      test_run_id: 'ci-run-0001',
      connector_binding_id: BINDING_ID,
      environment: 'CI',
    },
    signing_result: 'SIGNED',
    signature_ref: `credentials/${req.credential_id}/signed.pdf`,
    signed_artifact_sha256: hex(`signed:${req.idempotency_key}`),
    provider_transaction_ref: `sim-txn-${req.attempt_number}`,
  };
}

export function simulatedFailed(req: SigningRequest): SigningAdapterResult {
  return {
    connector_binding_id: BINDING_ID,
    integration_contract: 'INT-013',
    connector_mode: 'SIMULATED',
    simulation_marker: {
      simulation: true,
      scenario: 'esign_failure',
      test_run_id: 'ci-run-0001',
      connector_binding_id: BINDING_ID,
      environment: 'CI',
    },
    signing_result: 'FAILED',
    failure_code: 'SF-CRED-001',
    provider_transaction_ref: `sim-txn-${req.attempt_number}`,
  };
}

export class FakeSigner implements SigningPort {
  readonly calls: SigningRequest[] = [];
  script: SignerScript[] = [];
  fallback: SignerScript = simulatedSigned;

  constructor(private readonly probe: TxProbe) {}

  sign(_ctx: TenantContext, req: SigningRequest): Promise<SigningAdapterResult> {
    this.probe.check();
    this.calls.push(req);
    const step = this.script.shift() ?? this.fallback;
    const out = step(req);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  }
}

export class FakeRegistry implements CredentialRegistryPort {
  readonly calls: RegistrationRequest[] = [];
  failures: Error[] = [];
  status: RegistrationAck['current_status'] = 'ACTIVE';
  echoId: string | null = null;

  constructor(private readonly probe: TxProbe) {}

  register(_ctx: TenantContext, req: RegistrationRequest): Promise<RegistrationAck> {
    this.probe.check();
    this.calls.push(req);
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    return Promise.resolve({
      credential_id: this.echoId ?? req.credential_id,
      current_status: this.status,
    });
  }
}
