import { randomUUID } from 'node:crypto';
import type { AuthorizationPort } from '../../src/authz.js';
import type { ContextResolver } from '../../src/context.js';
import type { TenantContext } from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const CITIZEN_A = '22222222-2222-4222-8222-222222222222';
export const OFFICER_A = '33333333-3333-4333-8333-333333333333';
export const SYSTEM_A = '44444444-4444-4444-8444-444444444444';
export const CORR = '55555555-5555-4555-8555-555555555555';
export const TRACE = '66666666-6666-4666-8666-666666666666';

export function citizenCtx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant_id: TENANT_A,
    cell_id: 'cell-platform',
    actor: { type: 'CITIZEN', id: CITIZEN_A },
    roles: ['citizen'],
    jurisdiction_ids: ['IN-XX'],
    auth_assurance: 'OTP',
    correlation_id: CORR,
    trace_id: TRACE,
    ...overrides,
  };
}

export function officerCtx(overrides: Partial<TenantContext> = {}): TenantContext {
  return citizenCtx({
    actor: { type: 'OFFICER', id: OFFICER_A },
    roles: ['privacy_officer'],
    auth_assurance: 'MFA',
    ...overrides,
  });
}

export function systemCtx(overrides: Partial<TenantContext> = {}): TenantContext {
  return citizenCtx({
    actor: { type: 'SYSTEM', id: SYSTEM_A },
    roles: ['privacy_worker'],
    auth_assurance: 'WORKLOAD_IDENTITY',
    ...overrides,
  });
}

export function allowAllAuthorizer(): AuthorizationPort {
  return {
    async decide() {
      return {
        allow: true,
        reason_code: 'ALLOW',
        policy_revision: 'test-1',
        decision_id: randomUUID(),
      };
    },
  };
}

export function denyAllAuthorizer(): AuthorizationPort {
  return {
    async decide() {
      return {
        allow: false,
        reason_code: 'DENY',
        policy_revision: 'test-1',
        decision_id: randomUUID(),
      };
    },
  };
}

export function fixedContext(ctx: TenantContext): ContextResolver {
  return async () => ctx;
}

export const SAMPLE_SCOPE = [
  { owner_component: 'CMP-030', scope_ref: 'consent.purpose.residence' },
  { owner_component: 'CMP-032', scope_ref: 'storage.case.documents' },
];

export function idem(key = 'idem-m09-006-0001'): {
  key: string;
  fingerprint: string;
  endpoint: string;
} {
  return {
    key,
    fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    endpoint: 'POST /v1/privacy/requests',
  };
}
