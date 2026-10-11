import type {
  AttemptOutcome,
  Channel,
  ConnectorMode,
  DeploymentEnvironment,
  DispatchStatus,
  HandleClass,
} from '../domain/model.js';
import type { SimulationMarker } from '../domain/simulation.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface TemplateRow {
  template_ref: string;
  template_version: number;
  channel: Channel;
  locale: string;
  subject_template: string | null;
  body_template: string;
  allowed_params: string[];
  published_by: string;
  published_at: string;
  correlation_id: string;
}

export interface DispatchRow {
  tenant_id: string;
  dispatch_id: string;
  application_id: string | null;
  cell_id: string;
  template_ref: string;
  template_version: number;
  channel: Channel;
  locale: string;
  recipient_handle_class: HandleClass;
  recipient_handle_ref: string;
  template_params: Record<string, string>;
  connector_binding_id: string;
  connector_mode: ConnectorMode;
  connector_environment: DeploymentEnvironment;
  connector_critical: boolean;
  simulation_marker: SimulationMarker | null;
  status: DispatchStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  provider_message_ref: string | null;
  last_error_code: string | null;
  idempotency_key: string;
  requested_by: string;
  requested_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  correlation_id: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface AttemptRow {
  dispatch_id: string;
  attempt_no: number;
  outcome: AttemptOutcome;
  error_code: string | null;
  provider_message_ref: string | null;
  connector_mode: ConnectorMode;
  simulation_marker: SimulationMarker | null;
  occurred_at: string;
  correlation_id: string;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface NotificationTx {
  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'>;
  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;
  insertTemplate(row: TemplateRow): Promise<void>;
  /** Latest published version unless `version` is given (version pinning). */
  getTemplate(
    ref: string,
    channel: Channel,
    locale: string,
    version?: number,
  ): Promise<TemplateRow | undefined>;
  listTemplateVersions(ref: string): Promise<TemplateRow[]>;
  insertDispatch(row: DispatchRow): Promise<void>;
  getDispatch(dispatchId: string): Promise<DispatchRow | undefined>;
  updateDispatch(row: DispatchRow): Promise<void>;
  /** Moves due rows (and expired leases) to SENDING with a fresh lease; short, no network. */
  claimDue(p: {
    limit: number;
    now: Date;
    leaseOwner: string;
    leaseMs: number;
  }): Promise<DispatchRow[]>;
  insertAttempt(row: AttemptRow): Promise<void>;
  listAttempts(dispatchId: string): Promise<AttemptRow[]>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface NotificationRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: NotificationTx) => Promise<T>): Promise<T>;
}
