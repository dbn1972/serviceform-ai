import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
} from '@serviceform/contracts';
import { Cmp004Error } from './errors.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export async function authorize(port: AuthorizationPort, input: AuthzDecisionInput): Promise<void> {
  const inCheck = validate('authz-decision-input', input);
  if (!inCheck.valid) throw new Cmp004Error('SF-AUTH-002');
  if (
    input.resource.classification === 'TENANT_SCOPED' &&
    input.subject.tenant_id !== null &&
    input.resource.tenant_id !== null &&
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp004Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp004Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  const outCheck = validate('authz-decision-output', output);
  if (!outCheck.valid || output.allow !== true) throw new Cmp004Error('SF-AUTH-002');
}

export const denyAllAuthorization: AuthorizationPort = {
  async decide(): Promise<AuthzDecisionOutput> {
    return {
      allow: false,
      reason_code: 'DEFAULT_DENY',
      policy_revision: 'none',
      decision_id: '00000000-0000-4000-8000-000000000000',
    };
  },
};
