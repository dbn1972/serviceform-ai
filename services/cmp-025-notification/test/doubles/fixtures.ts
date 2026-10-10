import type { AuthorizationPort } from '../../src/authz.js';
import type { ConnectorBindingView } from '../../src/domain/simulation.js';
import type { ConnectorBindingPort } from '../../src/ports/connector-binding-port.js';
import type {
  RecipientDirectoryPort,
  RecipientLookup,
} from '../../src/ports/recipient-directory-port.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const ACTOR_SYSTEM = '44444444-4444-4444-8444-444444444444';
export const ACTOR_INTEGRATION = '55555555-5555-4555-8555-555555555555';
export const ACTOR_CITIZEN = '66666666-6666-4666-8666-666666666666';
export const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';
export const BINDING_SMS = '77777777-7777-4777-8777-777777777777';
export const BINDING_EMAIL = '88888888-8888-4888-8888-888888888888';

/** Canary values: tests assert none of these ever reach logs, events, rows or errors. */
export const CANARY_ADDRESS = '+919876543210';
export const CANARY_EMAIL = 'canary.person@example.invalid';
export const CANARY_SECRET_REF = 'aws-sm://sf/notify/CANARY-secret-ref';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_OFFICER,
  type: RequestContext['actor']['type'] = 'OFFICER',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'OFFICER' ? ['CASE_OFFICER'] : [type],
    jurisdiction_ids: [],
    auth_assurance: type === 'SYSTEM' || type === 'INTEGRATION' ? 'WORKLOAD_IDENTITY' : 'MFA',
    correlation_id: '99999999-9999-4999-8999-999999999990',
    trace_id: '0123456789abcdef0123456789abcdef',
  };
}

export const systemCtx = (tenantId = TENANT_A): TenantContext =>
  ctxFor(tenantId, ACTOR_SYSTEM, 'SYSTEM');
export const integrationCtx = (tenantId = TENANT_A): TenantContext => ({
  ...ctxFor(tenantId, ACTOR_INTEGRATION, 'INTEGRATION'),
  purpose: 'NOTIFICATION_DELIVERY_RECEIPT',
});

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
      decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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

export function simulatedBinding(over: Partial<ConnectorBindingView> = {}): ConnectorBindingView {
  return {
    connector_binding_id: BINDING_SMS,
    tenant_id: TENANT_A,
    connector_type: 'SMS',
    mode: 'SIMULATED',
    environment: 'CI',
    critical: true,
    secret_ref: null,
    simulator_version: 'sim-1',
    ...over,
  };
}

export function realBinding(over: Partial<ConnectorBindingView> = {}): ConnectorBindingView {
  return {
    connector_binding_id: BINDING_SMS,
    tenant_id: TENANT_A,
    connector_type: 'SMS',
    mode: 'REAL',
    environment: 'PRODUCTION',
    critical: true,
    secret_ref: CANARY_SECRET_REF,
    ...over,
  };
}

export class MapBindingPort implements ConnectorBindingPort {
  readonly bindings = new Map<string, ConnectorBindingView>();
  down = false;
  calls = 0;
  inTx: (() => boolean) | undefined;
  resolve(_tenantId: string, id: string): Promise<ConnectorBindingView | null> {
    this.calls += 1;
    if (this.inTx?.()) throw new Error('NETWORK_IN_TX');
    if (this.down) return Promise.reject(new Error('hub down: secret CANARY-should-not-leak'));
    return Promise.resolve(this.bindings.get(id) ?? null);
  }
}

export class MapRecipientDirectory implements RecipientDirectoryPort {
  readonly addresses = new Map<string, string>();
  down = false;
  inTx: (() => boolean) | undefined;
  resolve(lookup: RecipientLookup): Promise<{ address: string } | null> {
    if (this.inTx?.()) throw new Error('NETWORK_IN_TX');
    if (this.down) return Promise.reject(new Error(`directory down for ${CANARY_ADDRESS}`));
    const address = this.addresses.get(`${lookup.tenantId}:${lookup.handleRef}`);
    return Promise.resolve(address === undefined ? null : { address });
  }
}

export const TEMPLATE_BODY = {
  template_ref: 'tpl.payment.received.v1',
  channel: 'SMS',
  locale: 'en-IN',
  body_template: 'Payment of {{amount_text}} received for {{reference_no}}.',
  allowed_params: ['amount_text', 'reference_no'],
};

export const DISPATCH_BODY = {
  application_id: APPLICATION_ID,
  template_ref: 'tpl.payment.received.v1',
  channel: 'SMS',
  locale: 'en-IN',
  recipient_handle_class: 'CITIZEN_HANDLE_REF',
  recipient_handle_ref: 'handle.citizen.demo.001',
  connector_binding_id: BINDING_SMS,
  template_params: { amount_text: 'INR 150', reference_no: 'APP-2026-000123' },
};
