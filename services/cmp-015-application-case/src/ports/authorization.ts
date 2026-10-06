import type { ActorType, AuthAssurance, AuthzDecisionOutput } from '../domain/validate.js';

/** SF-CON-AUTHZ-DECISION input (OPA PDP). CMP-015 is a PEP; it fails closed. */
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
    organisation_id?: string;
    jurisdiction_id?: string;
    service_id?: string;
    application_id?: string;
    owner_id?: string;
    classification?: 'TENANT_SCOPED';
  };
  action: string;
  workflow_context?: {
    workflow_instance_id?: string;
    workflow_node_id?: string;
    required_role?: string;
    required_action?: string;
    task_state?: string;
  };
  environment?: {
    request_time?: string;
    client_id?: string;
    risk_flags?: string[];
    trace_id?: string;
  };
}

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
