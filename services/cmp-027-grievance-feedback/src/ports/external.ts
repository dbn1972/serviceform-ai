import type { Assignment } from '../domain/model.js';
import type { TenantRequestContext } from '../domain/validate.js';
import { Cmp027Error, detail } from '../errors.js';

/** CMP-016 Temporal sequencing after domain commit. Failure defers to the committed outbox. */
export interface WorkflowAdvanceSignal {
  tenant_id: string;
  grievance_id: string;
  aggregate_version: number;
  to_status: string;
  workflow_version_id: string | null;
  idempotency_key: string;
  correlation_id: string;
}

export interface WorkflowAdvancePort {
  advance(signal: WorkflowAdvanceSignal): Promise<void>;
}

export class OutboxOnlyWorkflowAdvance implements WorkflowAdvancePort {
  async advance(): Promise<void> {
    return undefined;
  }
}

/**
 * CMP-017 human-task CREATE (SF-CON-HUMAN-TASK). Invoked only when an opaque application_id
 * linkage exists so the frozen contract required field can be populated. Never names an officer.
 */
export interface HumanTaskCreateRequest {
  application_id: string;
  workflow_node_id: string;
  assignment: Assignment;
  idempotency_key: string;
}

export interface HumanTaskPort {
  create(ctx: TenantRequestContext, request: HumanTaskCreateRequest): Promise<void>;
}

export class NoopHumanTaskPort implements HumanTaskPort {
  async create(): Promise<void> {
    return undefined;
  }
}

/** Routing from published policy metadata — never named-service / department / scheme branches. */
export interface RoutingPolicyPort {
  resolve(
    ctx: TenantRequestContext,
    input: {
      category_code: string;
      kind: string;
      organisation_id: string | null;
      jurisdiction_id: string | null;
      service_scope_id: string | null;
    },
  ): Promise<Assignment>;
}

export class DenyRoutingPolicyPort implements RoutingPolicyPort {
  async resolve(): Promise<Assignment> {
    throw new Cmp027Error('SF-SYS-004', { details: detail('ROUTING_POLICY_NOT_CONFIGURED') });
  }
}

/** Opaque application/service linkage permission (no FK, no cross-component SQL). */
export interface LinkagePolicyPort {
  allow(
    ctx: TenantRequestContext,
    input: { service_id: string | null; application_id: string | null },
  ): Promise<boolean>;
}

export class AllowLinkagePolicyPort implements LinkagePolicyPort {
  readonly simulation = 'SIMULATED' as const;
  async allow(): Promise<boolean> {
    return true;
  }
}

/** M06 CMP-025 notification port only. No SMS/email provider in this component. */
export interface NotificationPort {
  requestNotification(params: {
    tenant_id: string;
    grievance_id: string;
    template_ref: string;
    idempotency_key: string;
  }): Promise<{ notification_ref: string }>;
}

export const unconfiguredNotificationPort: NotificationPort = {
  async requestNotification() {
    throw new Cmp027Error('SF-SYS-004', { details: detail('NOTIFICATION_PORT_NOT_CONFIGURED') });
  },
};
