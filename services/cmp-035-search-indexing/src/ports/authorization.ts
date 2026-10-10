import type { ActorType, AuthAssurance, AuthzDecisionOutput } from '../domain/validate.js';

export interface AuthzDecisionInput {
  subject: {
    user_id: string;
    actor_type: ActorType;
    tenant_id: string | null;
    organisation_id?: string;
    office_id?: string;
    roles: string[];
    jurisdiction_ids: string[];
    assurance?: AuthAssurance;
    delegation_id?: string;
  };
  resource: {
    resource_type: string;
    tenant_id: string | null;
    classification?: 'TENANT_SCOPED';
  };
  action: string;
  environment?: {
    request_time?: string;
    trace_id?: string;
  };
}

/** SF-CON-AUTHZ-DECISION. OPA is the PDP; the host binds the real adapter. */
export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export function denyAllAuthorization(): AuthorizationPort {
  return {
    async decide() {
      return {
        allow: false,
        reason_code: 'DEFAULT_DENY',
        policy_revision: 'unconfigured',
        decision_id: '00000000-0000-4000-8000-000000000000',
      };
    },
  };
}
