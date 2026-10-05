import type { Assignment, PortNodeKind } from './domain/model.js';

/**
 * Outbound ports. CMP-016 talks to sibling components only through their published contracts
 * (Constitution #23). There is deliberately NO port that writes CMP-015 case state: the workflow
 * engine learns about case transitions only from committed SF-CON-COMMAND-TRANSITION records.
 */

export type ActorType = 'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION' | 'PRIVILEGED_ADMIN';

/** Server-resolved subset of SF-CON-REQUEST-CONTEXT used by this component. */
export interface WorkflowContext {
  tenant_id: string;
  cell_id: string;
  actor: { type: ActorType; id: string };
  correlation_id: string;
  trace_id: string;
}

export type WorkflowAction =
  | 'WORKFLOW_DEFINITION_CREATE'
  | 'WORKFLOW_VERSION_DRAFT'
  | 'WORKFLOW_VERSION_IMPORT_BPMN'
  | 'WORKFLOW_VERSION_EXPORT_BPMN'
  | 'WORKFLOW_VERSION_PUBLISH'
  | 'WORKFLOW_VERSION_RETIRE'
  | 'WORKFLOW_INSTANCE_START'
  | 'WORKFLOW_SIGNAL_ADVANCE'
  | 'WORKFLOW_REQUEST_SUBMIT'
  | 'WORKFLOW_MIGRATION_APPROVE'
  | 'WORKFLOW_MIGRATION_APPLY';

/** OPA via CMP-048 (SF-CON-AUTHZ-DECISION). Deny by default. */
export interface AuthorizationPort {
  authorize(
    ctx: WorkflowContext,
    action: WorkflowAction,
    resource: { type: string; id?: string },
  ): Promise<{ allow: boolean; decision_id: string; policy_revision: string }>;
}

/** CMP-051 maker-checker approval lookup for publication and migration. */
export interface ApprovalPort {
  verify(
    ctx: WorkflowContext,
    request: {
      subject_type: 'WorkflowVersion' | 'WorkflowMigration';
      subject_id: string;
      content_hash: string;
      approval_ref: string;
    },
  ): Promise<{ approved: boolean; approver_id: string }>;
}

/** CMP-017 human-task API (SF-CON-HUMAN-TASK CREATE / CANCEL_CLOSE). No named principal. */
export interface HumanTaskPort {
  create(
    ctx: WorkflowContext,
    request: {
      application_id: string;
      workflow_node_id: string;
      assignment: Assignment;
      idempotency_key: string;
    },
  ): Promise<void>;
  cancelClose(
    ctx: WorkflowContext,
    request: { application_id: string; workflow_node_id: string; idempotency_key: string },
  ): Promise<void>;
}

/** CMP-008 deterministic rule evaluation (GoRules). Returns an outcome code, never a decision. */
export interface RuleEvaluationPort {
  evaluate(
    ctx: WorkflowContext,
    request: { application_id: string; node_id: string; rule_ref: string },
  ): Promise<{ outcome: string }>;
}

/** Configured service activities (connector calls via CMP-037, deficiency via CMP-019). */
export interface ServiceActivityPort {
  invoke(
    ctx: WorkflowContext,
    request: { application_id: string; node_id: string; kind: 'SERVICE_ACTIVITY' | 'DEFICIENCY' },
  ): Promise<{ outcome?: string }>;
}

/** PAYMENT / SIGN / ISSUE / NOTIFY are declared ports; M05 implements no provider. */
export interface ProcessPort {
  invoke(
    ctx: WorkflowContext,
    request: { application_id: string; node_id: string; port: PortNodeKind },
  ): Promise<{ outcome?: string }>;
}

/** CMP-029 SLA/calendar policy resolves TIMER node durations; the graph carries no durations. */
export interface TimerPolicyPort {
  durationMs(
    ctx: WorkflowContext,
    request: { workflow_version_id: string; node_id: string },
  ): Promise<number>;
}

/** Subset of the Temporal client used by the adapter (start + signal only). */
export interface TemporalClientPort {
  start(request: {
    workflowId: string;
    taskQueue: string;
    workflowType: string;
    args: unknown[];
  }): Promise<{ runId: string }>;
  signal(workflowId: string, signalName: string, payload: unknown): Promise<void>;
}
