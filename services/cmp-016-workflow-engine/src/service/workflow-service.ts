import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { importBpmn, exportBpmn } from '../bpmn/profile.js';
import { envelopeOf, insertOutbox } from '../db/outbox.js';
import { withTenantTx, type SqlClient, type SqlPool } from '../db/tx.js';
import { Cmp016Error, invalid, mapPgError, reject } from '../errors.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { activeNodes, type InstanceState } from '../domain/interpreter.js';
import { validatePlan, type MigrationPlan } from '../domain/migration.js';
import { CODE_RE, UUID_RE, nodeIndex, outgoing, type NodeKind } from '../domain/model.js';
import {
  assertCommitted,
  signalFromCommandTransition,
  type CommandTransitionRecord,
  type CommittedSignal,
} from '../domain/signals.js';
import {
  assertExecutable,
  newDraft,
  publish,
  retire,
  reviseDraft,
  type VersionOrigin,
  type WorkflowVersionRecord,
} from '../domain/versioning.js';
import type { ApprovalPort, AuthorizationPort, WorkflowAction, WorkflowContext } from '../ports.js';
import * as repo from '../repo/workflow-repo.js';
import { temporalWorkflowId, type TemporalSequencingAdapter } from '../temporal/adapter.js';

export const CASE_TRANSITION_CONSUMER = 'cmp-016.case-transitions';
const DEFINITION_KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const COMMIT_WAIT_KINDS: NodeKind[] = [
  'HUMAN_TASK',
  'WAIT',
  'WITHDRAWAL_REVIEW',
  'CANCELLATION_REVIEW',
  'TIMER',
];

export interface WorkflowServiceDeps {
  pool: SqlPool;
  authz: AuthorizationPort;
  approvals: ApprovalPort;
  temporal: TemporalSequencingAdapter;
  now?: () => Date;
  newId?: () => string;
}

export interface AdvanceResult {
  phase: 'TEMPORAL_ADVANCE';
  domain_committed: true;
  temporal_advanced: true;
  signal_id: string;
}

function requireUuid(value: unknown, pointer: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw invalid('UUID_REQUIRED', pointer);
  return value;
}

/**
 * CMP-016 application service. Every write follows: authorize -> short PostgreSQL transaction
 * (own schema + outbox) -> commit -> only then Temporal. Never the reverse.
 */
export class WorkflowService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: WorkflowServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
  }

  private async authorize(
    ctx: WorkflowContext,
    action: WorkflowAction,
    resource: { type: string; id?: string },
  ): Promise<void> {
    const decision = await this.deps.authz.authorize(ctx, action, resource);
    if (!decision.allow) throw new Cmp016Error('SF-AUTH-002');
  }

  private async tx<T>(ctx: WorkflowContext, fn: (c: SqlClient) => Promise<T>): Promise<T> {
    try {
      return await withTenantTx(this.deps.pool, ctx, fn);
    } catch (err) {
      throw mapPgError(err);
    }
  }

  private async loadVersion(
    c: SqlClient,
    versionId: string,
    forUpdate = false,
  ): Promise<WorkflowVersionRecord> {
    const v = await repo.getVersion(c, versionId, { forUpdate });
    if (!v) throw new Cmp016Error('SF-SYS-002');
    return v;
  }

  async createDefinition(
    ctx: WorkflowContext,
    input: { definition_key: string },
  ): Promise<{ definition_id: string }> {
    if (!DEFINITION_KEY_RE.test(input.definition_key))
      throw invalid('DEFINITION_KEY_INVALID', '/definition_key');
    await this.authorize(ctx, 'WORKFLOW_DEFINITION_CREATE', { type: 'WorkflowDefinition' });
    const definitionId = this.newId();
    await this.tx(ctx, async (c) => {
      await repo.insertDefinition(c, {
        definition_id: definitionId,
        tenant_id: ctx.tenant_id,
        cell_id: ctx.cell_id,
        definition_key: input.definition_key,
        created_by: ctx.actor.id,
      });
      await appendAudit(c, ctx, {
        action: 'WORKFLOW_DEFINITION_CREATE',
        actionClass: 'WRITE',
        resourceType: 'WorkflowDefinition',
        resourceId: definitionId,
        result: 'SUCCESS',
        at: this.now().toISOString(),
      });
    });
    return { definition_id: definitionId };
  }

  async createDraft(
    ctx: WorkflowContext,
    input: { definition_id: string; graph: unknown; origin?: VersionOrigin },
  ): Promise<WorkflowVersionRecord> {
    const definitionId = requireUuid(input.definition_id, '/definition_id');
    const origin = input.origin ?? 'STUDIO';
    await this.authorize(
      ctx,
      origin === 'BPMN_IMPORT' ? 'WORKFLOW_VERSION_IMPORT_BPMN' : 'WORKFLOW_VERSION_DRAFT',
      { type: 'WorkflowDefinition', id: definitionId },
    );
    return this.tx(ctx, async (c) => {
      if (!(await repo.definitionExists(c, definitionId))) throw new Cmp016Error('SF-SYS-002');
      const draft = newDraft({
        tenant_id: ctx.tenant_id,
        definition_id: definitionId,
        version_id: this.newId(),
        version_no: await repo.nextVersionNo(c, definitionId),
        origin,
        authored_by: ctx.actor.id,
        graph: input.graph,
      });
      await repo.insertVersion(c, draft);
      return draft;
    });
  }

  async reviseDraft(
    ctx: WorkflowContext,
    input: { version_id: string; graph: unknown },
  ): Promise<WorkflowVersionRecord> {
    const versionId = requireUuid(input.version_id, '/version_id');
    await this.authorize(ctx, 'WORKFLOW_VERSION_DRAFT', { type: 'WorkflowVersion', id: versionId });
    return this.tx(ctx, async (c) => {
      const revised = reviseDraft(await this.loadVersion(c, versionId, true), input.graph);
      await repo.updateDraftModel(c, revised);
      return revised;
    });
  }

  /** BPMN import yields an unpublished canonical draft only; it is never executed as BPMN. */
  async importBpmnDraft(
    ctx: WorkflowContext,
    input: { definition_id: string; xml: string },
  ): Promise<WorkflowVersionRecord> {
    if (typeof input.xml !== 'string') throw invalid('BPMN_XML_REQUIRED', '/xml');
    const imported = importBpmn(input.xml);
    return this.createDraft(ctx, {
      definition_id: input.definition_id,
      graph: imported.graph,
      origin: 'BPMN_IMPORT',
    });
  }

  async exportBpmn(ctx: WorkflowContext, versionId: string): Promise<string> {
    requireUuid(versionId, '/version_id');
    await this.authorize(ctx, 'WORKFLOW_VERSION_EXPORT_BPMN', {
      type: 'WorkflowVersion',
      id: versionId,
    });
    const v = await this.tx(ctx, (c) => this.loadVersion(c, versionId));
    return exportBpmn(v.model);
  }

  async publish(
    ctx: WorkflowContext,
    input: { version_id: string; approval_ref: string },
  ): Promise<WorkflowVersionRecord> {
    const versionId = requireUuid(input.version_id, '/version_id');
    await this.authorize(ctx, 'WORKFLOW_VERSION_PUBLISH', {
      type: 'WorkflowVersion',
      id: versionId,
    });
    const draft = await this.tx(ctx, (c) => this.loadVersion(c, versionId));
    if (draft.status !== 'DRAFT') throw reject('PUBLISHED_VERSION_IMMUTABLE', '/status');
    const approval = await this.deps.approvals.verify(ctx, {
      subject_type: 'WorkflowVersion',
      subject_id: versionId,
      content_hash: draft.model.graph_hash,
      approval_ref: input.approval_ref,
    });
    if (!approval.approved) throw new Cmp016Error('SF-AUTH-002', [{ code: 'APPROVAL_MISSING' }]);
    const at = this.now().toISOString();
    return this.tx(ctx, async (c) => {
      const current = await this.loadVersion(c, versionId, true);
      if (current.model.graph_hash !== draft.model.graph_hash)
        throw reject('DRAFT_CHANGED_SINCE_APPROVAL');
      const published = publish(current, {
        approver_id: approval.approver_id,
        approval_ref: input.approval_ref,
        at,
      });
      await repo.markPublished(c, published);
      await insertOutbox(
        c,
        envelopeOf(ctx, {
          eventType: 'WorkflowVersionPublished',
          aggregateType: 'WorkflowVersion',
          aggregateId: versionId,
          aggregateVersion: published.version_no,
          occurredAt: at,
          data: {
            definition_id: published.definition_id,
            version_id: versionId,
            version_no: published.version_no,
            graph_hash: published.model.graph_hash,
            origin: published.origin,
          },
        }),
      );
      await appendAudit(c, ctx, {
        action: 'WORKFLOW_VERSION_PUBLISH',
        actionClass: 'PRIVILEGED',
        resourceType: 'WorkflowVersion',
        resourceId: versionId,
        result: 'SUCCESS',
        at,
      });
      return published;
    });
  }

  async retire(ctx: WorkflowContext, versionId: string): Promise<WorkflowVersionRecord> {
    requireUuid(versionId, '/version_id');
    await this.authorize(ctx, 'WORKFLOW_VERSION_RETIRE', {
      type: 'WorkflowVersion',
      id: versionId,
    });
    const at = this.now().toISOString();
    return this.tx(ctx, async (c) => {
      const retired = retire(await this.loadVersion(c, versionId, true), at);
      await repo.markRetired(c, retired);
      await insertOutbox(
        c,
        envelopeOf(ctx, {
          eventType: 'WorkflowVersionRetired',
          aggregateType: 'WorkflowVersion',
          aggregateId: versionId,
          aggregateVersion: retired.version_no,
          occurredAt: at,
          data: { version_id: versionId, graph_hash: retired.model.graph_hash },
        }),
      );
      await appendAudit(c, ctx, {
        action: 'WORKFLOW_VERSION_RETIRE',
        actionClass: 'PRIVILEGED',
        resourceType: 'WorkflowVersion',
        resourceId: versionId,
        result: 'SUCCESS',
        at,
      });
      return retired;
    });
  }

  /** Binds an application to a published version, commits, then starts the Temporal execution. */
  async startInstance(
    ctx: WorkflowContext,
    input: { application_id: string; workflow_version_id: string },
  ): Promise<{ instance_id: string; temporal_workflow_id: string }> {
    const applicationId = requireUuid(input.application_id, '/application_id');
    const versionId = requireUuid(input.workflow_version_id, '/workflow_version_id');
    await this.authorize(ctx, 'WORKFLOW_INSTANCE_START', {
      type: 'Application',
      id: applicationId,
    });
    const instanceId = this.newId();
    const workflowId = temporalWorkflowId(ctx.tenant_id, applicationId);
    const at = this.now().toISOString();
    const executable = await this.tx(ctx, async (c) => {
      const exe = assertExecutable(await this.loadVersion(c, versionId));
      await repo.insertInstance(c, {
        instance_id: instanceId,
        tenant_id: ctx.tenant_id,
        cell_id: ctx.cell_id,
        application_id: applicationId,
        workflow_version_id: versionId,
        graph_hash: exe.model.graph_hash,
        temporal_workflow_id: workflowId,
        status: 'RUNNING',
        active_nodes: [],
      });
      await insertOutbox(
        c,
        envelopeOf(ctx, {
          eventType: 'WorkflowInstanceStarted',
          aggregateType: 'WorkflowInstance',
          aggregateId: instanceId,
          aggregateVersion: 1,
          occurredAt: at,
          data: {
            application_id: applicationId,
            workflow_version_id: versionId,
            graph_hash: exe.model.graph_hash,
          },
        }),
      );
      await appendAudit(c, ctx, {
        action: 'WORKFLOW_INSTANCE_START',
        actionClass: 'WRITE',
        resourceType: 'WorkflowInstance',
        resourceId: instanceId,
        result: 'SUCCESS',
        at,
      });
      return exe;
    });
    await this.deps.temporal.start(ctx, executable, applicationId);
    return { instance_id: instanceId, temporal_workflow_id: workflowId };
  }

  /**
   * Consumer of CMP-015 committed transitions (delivered from CMP-015's outbox via CMP-038).
   * Rejects any record that is not a completed domain commit before touching the database or
   * Temporal. CMP-016 never writes case state; it only advances its own sequencing.
   */
  async onCaseTransitionCommitted(
    ctx: WorkflowContext,
    record: CommandTransitionRecord,
    outboxEventId: string,
  ): Promise<AdvanceResult> {
    const signal = signalFromCommandTransition(record, outboxEventId);
    if (signal.tenant_id !== ctx.tenant_id) throw new Cmp016Error('SF-TEN-002');
    await this.authorize(ctx, 'WORKFLOW_SIGNAL_ADVANCE', {
      type: 'Application',
      id: signal.application_id,
    });
    return this.deliver(ctx, signal);
  }

  private async deliver(ctx: WorkflowContext, signal: CommittedSignal): Promise<AdvanceResult> {
    assertCommitted(signal);
    await this.tx(ctx, async (c) => {
      const instance = await repo.getInstanceByApplication(c, signal.application_id);
      if (!instance) throw new Cmp016Error('SF-SYS-002');
      if (instance.status !== 'RUNNING') throw reject('INSTANCE_NOT_RUNNING', '/status');
      if (instance.workflow_version_id !== signal.workflow_version_id) {
        throw reject('PINNED_VERSION_MISMATCH', '/workflow_version_id');
      }
    });
    await this.deps.temporal.advance(ctx, signal);
    await this.tx(ctx, (c) =>
      repo.recordInbox(c, {
        consumer_group: CASE_TRANSITION_CONSUMER,
        event_id: signal.outbox_event_id,
        tenant_id: ctx.tenant_id,
      }),
    );
    return {
      phase: 'TEMPORAL_ADVANCE',
      domain_committed: true,
      temporal_advanced: true,
      signal_id: signal.signal_id,
    };
  }

  /**
   * Records a withdrawal/cancellation request (ADR-0003: a workflow record, never a case state),
   * only where the pinned published workflow offers it at a currently active node (#17).
   */
  async submitRequest(
    ctx: WorkflowContext,
    input: {
      application_id: string;
      request_kind: 'WITHDRAWAL' | 'CANCELLATION';
      outcome: string;
      idempotency_key: string;
    },
  ): Promise<{ request_id: string; replayed: boolean }> {
    const applicationId = requireUuid(input.application_id, '/application_id');
    if (input.request_kind !== 'WITHDRAWAL' && input.request_kind !== 'CANCELLATION') {
      throw invalid('REQUEST_KIND_INVALID', '/request_kind');
    }
    if (!CODE_RE.test(input.outcome)) throw invalid('OUTCOME_INVALID', '/outcome');
    if (!IDEMPOTENCY_KEY_RE.test(input.idempotency_key))
      throw invalid('IDEMPOTENCY_KEY_INVALID', '/idempotency_key');
    await this.authorize(ctx, 'WORKFLOW_REQUEST_SUBMIT', {
      type: 'Application',
      id: applicationId,
    });
    const requestNodeKind =
      input.request_kind === 'WITHDRAWAL' ? 'WITHDRAWAL_REQUEST' : 'CANCELLATION_REQUEST';
    const at = this.now().toISOString();
    const result = await this.tx(ctx, async (c) => {
      const existing = await repo.findRequestByKey(c, applicationId, input.idempotency_key);
      if (existing) {
        if (existing.request_kind !== input.request_kind || existing.outcome !== input.outcome) {
          throw new Cmp016Error('SF-APP-002');
        }
        return { replayed: true as const, request_id: existing.request_id };
      }
      const instance = await repo.getInstanceByApplication(c, applicationId, { forUpdate: true });
      if (!instance) throw new Cmp016Error('SF-SYS-002');
      if (instance.status !== 'RUNNING') throw reject('INSTANCE_NOT_RUNNING', '/status');
      const version = await this.loadVersion(c, instance.workflow_version_id);
      const nodes = nodeIndex(version.model);
      const offeredAt = instance.active_nodes.filter((id) =>
        outgoing(version.model, id).some(
          (e) => e.outcome === input.outcome && nodes.get(e.to_node)?.kind === requestNodeKind,
        ),
      );
      if (offeredAt.length !== 1) throw reject('REQUEST_NOT_OFFERED', '/outcome');
      const requestId = this.newId();
      await repo.insertRequest(c, {
        request_id: requestId,
        tenant_id: ctx.tenant_id,
        instance_id: instance.instance_id,
        application_id: applicationId,
        request_kind: input.request_kind,
        request_node_id: offeredAt[0] as string,
        outcome: input.outcome,
        status: 'PENDING_REVIEW',
        requested_by: ctx.actor.id,
        idempotency_key: input.idempotency_key,
      });
      const outboxEventId = await insertOutbox(
        c,
        envelopeOf(ctx, {
          eventType: 'WorkflowRequestRecorded',
          aggregateType: 'WorkflowRequest',
          aggregateId: requestId,
          aggregateVersion: 1,
          occurredAt: at,
          data: {
            application_id: applicationId,
            request_kind: input.request_kind,
            outcome: input.outcome,
            workflow_version_id: instance.workflow_version_id,
          },
        }),
      );
      await appendAudit(c, ctx, {
        action: 'WORKFLOW_REQUEST_SUBMIT',
        actionClass: 'WRITE',
        resourceType: 'WorkflowRequest',
        resourceId: requestId,
        result: 'SUCCESS',
        at,
      });
      const signal: CommittedSignal = {
        signal_id: requestId,
        source_component: 'CMP-016',
        tenant_id: ctx.tenant_id,
        application_id: applicationId,
        workflow_version_id: instance.workflow_version_id,
        command_id: requestId,
        outcome: input.outcome,
        phase: 'DOMAIN_COMMITTED',
        domain_committed: true,
        outbox_event_id: outboxEventId,
        node_id: offeredAt[0] as string,
      };
      return { replayed: false as const, request_id: requestId, signal };
    });
    if (!result.replayed) await this.deliver(ctx, result.signal);
    return { request_id: result.request_id, replayed: result.replayed };
  }

  /** Records an approved migration plan (maker-checker + simulation evidence; Constitution #35). */
  async approveMigration(
    ctx: WorkflowContext,
    input: Omit<MigrationPlan, 'migration_id' | 'tenant_id' | 'approved_by' | 'requested_by'> & {
      requested_by: string;
    },
  ): Promise<MigrationPlan> {
    requireUuid(input.from_version_id, '/from_version_id');
    requireUuid(input.to_version_id, '/to_version_id');
    requireUuid(input.requested_by, '/requested_by');
    await this.authorize(ctx, 'WORKFLOW_MIGRATION_APPROVE', {
      type: 'WorkflowVersion',
      id: input.to_version_id,
    });
    const migrationId = this.newId();
    const contentHash = sha256(
      canonicalJson({
        from_version_id: input.from_version_id,
        to_version_id: input.to_version_id,
        node_mapping: input.node_mapping,
        simulation_evidence_ref: input.simulation_evidence_ref,
      }),
    );
    const approval = await this.deps.approvals.verify(ctx, {
      subject_type: 'WorkflowMigration',
      subject_id: input.to_version_id,
      content_hash: contentHash,
      approval_ref: input.approval_ref,
    });
    if (!approval.approved) throw new Cmp016Error('SF-AUTH-002', [{ code: 'APPROVAL_MISSING' }]);
    const plan: MigrationPlan = {
      migration_id: migrationId,
      tenant_id: ctx.tenant_id,
      from_version_id: input.from_version_id,
      to_version_id: input.to_version_id,
      node_mapping: input.node_mapping,
      approval_ref: input.approval_ref,
      simulation_evidence_ref: input.simulation_evidence_ref,
      requested_by: input.requested_by,
      approved_by: approval.approver_id,
    };
    const at = this.now().toISOString();
    return this.tx(ctx, async (c) => {
      const from = await this.loadVersion(c, plan.from_version_id);
      const toRecord = await this.loadVersion(c, plan.to_version_id);
      if (from.definition_id !== toRecord.definition_id) throw reject('MIGRATION_VERSION_MISMATCH');
      validatePlan(plan, from, assertExecutable(toRecord));
      await repo.insertMigrationPlan(c, plan);
      await appendAudit(c, ctx, {
        action: 'WORKFLOW_MIGRATION_APPROVE',
        actionClass: 'PRIVILEGED',
        resourceType: 'WorkflowMigration',
        resourceId: migrationId,
        result: 'SUCCESS',
        at,
      });
      return plan;
    });
  }

  /** Repoints one instance through an approved plan, at a safe boundary, then signals Temporal. */
  async applyMigration(
    ctx: WorkflowContext,
    input: { application_id: string; migration_id: string },
  ): Promise<void> {
    const applicationId = requireUuid(input.application_id, '/application_id');
    const migrationId = requireUuid(input.migration_id, '/migration_id');
    await this.authorize(ctx, 'WORKFLOW_MIGRATION_APPLY', {
      type: 'Application',
      id: applicationId,
    });
    const at = this.now().toISOString();
    const { target, plan } = await this.tx(ctx, async (c) => {
      const instance = await repo.getInstanceByApplication(c, applicationId, { forUpdate: true });
      const p = await repo.getMigrationPlan(c, migrationId);
      if (!instance || !p) throw new Cmp016Error('SF-SYS-002');
      if (p.from_version_id !== instance.workflow_version_id)
        throw reject('MIGRATION_VERSION_MISMATCH');
      const from = await this.loadVersion(c, p.from_version_id);
      const kinds = nodeIndex(from.model);
      const safe = instance.active_nodes.every((id) => {
        const k = kinds.get(id)?.kind;
        return k !== undefined && COMMIT_WAIT_KINDS.includes(k) && p.node_mapping[id] !== undefined;
      });
      if (!safe) throw reject('MIGRATION_NOT_AT_SAFE_BOUNDARY');
      const to = assertExecutable(await this.loadVersion(c, p.to_version_id));
      await repo.repointInstance(c, {
        instance_id: instance.instance_id,
        workflow_version_id: to.version_id,
        graph_hash: to.model.graph_hash,
        migration_id: migrationId,
      });
      await insertOutbox(
        c,
        envelopeOf(ctx, {
          eventType: 'WorkflowInstanceMigrated',
          aggregateType: 'WorkflowInstance',
          aggregateId: instance.instance_id,
          aggregateVersion: 1,
          occurredAt: at,
          data: {
            application_id: applicationId,
            migration_id: migrationId,
            from_version_id: p.from_version_id,
            to_version_id: p.to_version_id,
          },
        }),
      );
      await appendAudit(c, ctx, {
        action: 'WORKFLOW_MIGRATION_APPLY',
        actionClass: 'PRIVILEGED',
        resourceType: 'WorkflowInstance',
        resourceId: instance.instance_id,
        result: 'SUCCESS',
        at,
      });
      return { target: to, plan: p };
    });
    await this.deps.temporal.migrate(ctx, applicationId, target, plan);
  }

  /** Temporal activity: records the sequencing projection (own table only; never case state). */
  async recordProgress(
    ctx: WorkflowContext,
    input: { application_id: string; state: InstanceState; last_signal_id: string | null },
  ): Promise<void> {
    const applicationId = requireUuid(input.application_id, '/application_id');
    await this.tx(ctx, async (c) => {
      const instance = await repo.getInstanceByApplication(c, applicationId, { forUpdate: true });
      if (!instance) throw new Cmp016Error('SF-SYS-002');
      if (instance.status !== 'RUNNING') return;
      await repo.updateInstanceProgress(c, {
        instance_id: instance.instance_id,
        status: input.state.status,
        active_nodes: activeNodes(input.state),
        last_signal_id: input.last_signal_id,
      });
    });
  }
}
