/**
 * Structural mirrors of the FROZEN shared envelopes (contracts/shared). CMP-019 declares no
 * runtime package dependency; test/contract validates these shapes against the frozen schemas.
 */
export type ActorType = 'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION' | 'PRIVILEGED_ADMIN';

export interface Actor {
  type: ActorType;
  id: string;
}

export type AuthAssurance = 'NONE' | 'OTP' | 'PASSWORD' | 'MFA' | 'WORKLOAD_IDENTITY';

export interface RequestContext {
  tenant_id: string | null;
  cell_id: string;
  actor: Actor;
  organisation_id?: string;
  office_id?: string;
  roles: string[];
  jurisdiction_ids: string[];
  delegation_id?: string;
  auth_assurance: AuthAssurance;
  purpose?: string;
  correlation_id: string;
  trace_id: string;
}

export type TenantContext = RequestContext & { tenant_id: string };

export interface EventEnvelope<T extends object = Record<string, unknown>> {
  event_id: string;
  event_type: string;
  schema_version: number;
  tenant_id: string | null;
  cell_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  correlation_id: string;
  causation_id?: string;
  actor: Actor;
  data: T;
}

export interface AuditEvent {
  audit_id: string;
  occurred_at: string;
  tenant_id: string | null;
  cell_id: string;
  actor_type: ActorType;
  actor_id: string;
  action: string;
  action_class?: 'READ' | 'WRITE' | 'DECISION' | 'OVERRIDE' | 'PRIVILEGED';
  resource_type: string;
  resource_id: string;
  reason?: string;
  correlation_id: string;
  trace_id: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  classification?: 'TENANT_SCOPED';
}

export interface AuthzDecisionInput {
  subject: {
    user_id: string;
    actor_type: ActorType;
    tenant_id: string | null;
    roles: string[];
    jurisdiction_ids: string[];
    assurance?: AuthAssurance;
  };
  resource: {
    resource_type: string;
    tenant_id: string | null;
    application_id?: string;
    classification?: 'TENANT_SCOPED';
  };
  action: string;
  environment?: { trace_id?: string };
}

export interface AuthzDecisionOutput {
  allow: boolean;
  reason_code: string;
  policy_revision: string;
  decision_id: string;
}
