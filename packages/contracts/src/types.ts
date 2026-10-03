/**
 * TypeScript shapes for the shared envelopes in ../schemas. The JSON Schemas are authoritative;
 * test/contracts.test.ts checks these types against the schema examples.
 * Status: DRAFT until the Contract Guardian freezes them in orchestrator/contracts-lock.yaml.
 */

export type Uuid = string;
export type IsoTimestamp = string;

export type ActorType = 'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION' | 'PRIVILEGED_ADMIN';

export type IsolationClass =
  'GLOBAL' | 'TENANT_SCOPED' | 'JURISDICTION_SCOPED' | 'CITIZEN_PRIVATE' | 'PLATFORM_OPERATIONAL';

export interface Actor {
  type: ActorType;
  id: Uuid;
}

export type AuthAssurance = 'NONE' | 'OTP' | 'PASSWORD' | 'MFA' | 'WORKLOAD_IDENTITY';

export interface RequestContext {
  tenant_id: Uuid | null;
  cell_id: string;
  actor: Actor;
  organisation_id?: Uuid;
  office_id?: Uuid;
  roles: string[];
  jurisdiction_ids: Uuid[];
  delegation_id?: Uuid;
  auth_assurance: AuthAssurance;
  /** Required for INTEGRATION actors (TI v1.0 s6). */
  purpose?: string;
  correlation_id: Uuid;
  trace_id: string;
}

export interface EventEnvelope<TData extends object = Record<string, unknown>> {
  event_id: Uuid;
  event_type: string;
  schema_version: number;
  tenant_id: Uuid | null;
  cell_id: string;
  aggregate_type: string;
  aggregate_id: Uuid;
  aggregate_version: number;
  occurred_at: IsoTimestamp;
  correlation_id: Uuid;
  causation_id?: Uuid;
  actor: Actor;
  data: TData;
}

export interface ErrorDetail {
  code: string;
  pointer?: string;
  message?: string;
}

export interface ErrorResponse {
  error_code: string;
  message: string;
  correlation_id: Uuid;
  details?: ErrorDetail[];
}

export interface IdempotencyRecord {
  tenant_id: Uuid | null;
  principal_id: Uuid;
  endpoint: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_ref?: string;
  created_at: IsoTimestamp;
  expires_at: IsoTimestamp;
}

export interface AuditEvent {
  audit_id: Uuid;
  occurred_at: IsoTimestamp;
  tenant_id: Uuid | null;
  cell_id: string;
  actor_type: ActorType;
  actor_id: Uuid;
  organisation_id?: Uuid;
  office_id?: Uuid;
  jurisdiction_id?: Uuid;
  action: string;
  action_class?: 'READ' | 'WRITE' | 'DECISION' | 'OVERRIDE' | 'PRIVILEGED';
  resource_type: string;
  resource_id: string;
  before_ref?: string;
  after_ref?: string;
  reason?: string;
  correlation_id: Uuid;
  trace_id: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  classification?: IsolationClass;
  client_context?: { source_ip?: string; device_id?: string };
}

export interface AuthzDecisionInput {
  subject: {
    user_id: Uuid;
    actor_type: ActorType;
    tenant_id: Uuid | null;
    organisation_id?: Uuid;
    office_id?: Uuid;
    roles: string[];
    jurisdiction_ids: Uuid[];
    assurance?: AuthAssurance;
    delegation_id?: Uuid;
  };
  resource: {
    resource_type: string;
    tenant_id: Uuid | null;
    organisation_id?: Uuid;
    jurisdiction_id?: Uuid;
    service_id?: Uuid;
    application_id?: Uuid;
    task_id?: Uuid;
    owner_id?: Uuid;
    classification?: IsolationClass;
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
    request_time?: IsoTimestamp;
    client_id?: string;
    risk_flags?: string[];
    trace_id?: string;
  };
}

export interface AuthzDecisionOutput {
  allow: boolean;
  reason_code: string;
  policy_revision: string;
  decision_id: Uuid;
}

export type ConnectorMode = 'REAL' | 'SANDBOX' | 'SIMULATED';
export type DeploymentEnvironment =
  'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'PERFORMANCE' | 'UAT' | 'PREPROD' | 'PRODUCTION';

export interface ConnectorBinding {
  connector_binding_id: Uuid;
  tenant_id: Uuid | null;
  service_id?: Uuid;
  connector_type: 'PAYMENT' | 'OTP' | 'SMS' | 'EMAIL' | 'DIGILOCKER' | 'ESIGN' | 'DEPARTMENT_API';
  mode: ConnectorMode;
  environment: DeploymentEnvironment;
  critical: boolean;
  secret_ref: string | null;
  simulator_version?: string;
}

export interface SimulationMarker {
  simulation: true;
  scenario: string;
  test_run_id: string;
  connector_binding_id: Uuid;
  environment: 'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'PERFORMANCE';
}

export interface IsolationDeclaration {
  entity: string;
  owner_component: string;
  isolation_class: IsolationClass;
  rls?: 'FORCE' | 'NOT_APPLICABLE';
  justification?: string;
}

/** Transaction-local PostgreSQL settings (SF-CON-DB-SESSION-CONTEXT). */
export interface DbSessionContext {
  'app.tenant_id'?: Uuid;
  'app.cell_id': string;
  'app.actor_type': ActorType;
  'app.actor_id': Uuid;
  'app.correlation_id': Uuid;
}

/** Row of a component outbox table (SF-CON-OUTBOX). */
export interface OutboxRecord {
  seq: number;
  event_id: Uuid;
  tenant_id?: Uuid;
  topic: string;
  partition_key: string;
  event_type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: Uuid;
  aggregate_version: number;
  envelope: EventEnvelope;
  status: 'PENDING' | 'PUBLISHED' | 'DEAD_LETTERED';
  attempts: number;
  next_attempt_at: IsoTimestamp;
  lease_owner?: string;
  lease_expires_at?: IsoTimestamp;
  last_error_code?: string;
  created_at: IsoTimestamp;
  published_at?: IsoTimestamp;
}
