import { Cmp016Error, reject } from '../errors.js';
import { inDomainTransaction } from '../db/tx.js';
import type { MigrationPlan } from '../domain/migration.js';
import { assertCommitted, type CommittedSignal } from '../domain/signals.js';
import { assertHashIntegrity, parseCanonicalModel } from '../domain/validate.js';
import { isExecutable, type ExecutableVersion } from '../domain/versioning.js';
import type { CanonicalWorkflowModel } from '../domain/model.js';
import type { TemporalClientPort, WorkflowContext } from '../ports.js';

export const WORKFLOW_TYPE = 'serviceformCanonicalWorkflow';
export const SIGNAL_COMMITTED = 'sf.committedTransition';
export const SIGNAL_MIGRATE = 'sf.migrate';

export interface WorkflowStartInput {
  tenant_id: string;
  cell_id: string;
  application_id: string;
  workflow_version_id: string;
  graph_hash: string;
  model: CanonicalWorkflowModel;
}

export interface MigrateSignal {
  plan: MigrationPlan;
  target: { version_id: string; model: CanonicalWorkflowModel };
}

export function temporalWorkflowId(tenantId: string, applicationId: string): string {
  return `sf-wf:${tenantId}:${applicationId}`;
}

/**
 * Temporal sequencing adapter. Temporal is never authoritative case state: this adapter can
 * start an execution of a published canonical version and deliver post-commit signals. It has
 * no operation that changes CMP-015 state, and it refuses to touch Temporal while an
 * authoritative PostgreSQL transaction is open (SF-CON-COMMAND-TRANSITION
 * open_domain_txn_has_temporal_network = false).
 */
export class TemporalSequencingAdapter {
  constructor(
    private readonly client: TemporalClientPort,
    private readonly taskQueue: string,
  ) {}

  private assertOutsideDomainTx(): void {
    if (inDomainTransaction()) throw reject('TEMPORAL_CALL_INSIDE_DOMAIN_TXN');
  }

  async start(
    ctx: WorkflowContext,
    version: ExecutableVersion,
    applicationId: string,
  ): Promise<{ workflowId: string; runId: string }> {
    this.assertOutsideDomainTx();
    if (!isExecutable(version)) throw reject('VERSION_NOT_EXECUTABLE');
    if (version.tenant_id !== ctx.tenant_id) throw new Cmp016Error('SF-TEN-002');
    const model = parseCanonicalModel(version.model);
    assertHashIntegrity(model);
    const input: WorkflowStartInput = {
      tenant_id: ctx.tenant_id,
      cell_id: ctx.cell_id,
      application_id: applicationId,
      workflow_version_id: version.version_id,
      graph_hash: model.graph_hash,
      model,
    };
    const workflowId = temporalWorkflowId(ctx.tenant_id, applicationId);
    const { runId } = await this.client.start({
      workflowId,
      taskQueue: this.taskQueue,
      workflowType: WORKFLOW_TYPE,
      args: [input],
    });
    return { workflowId, runId };
  }

  /** Delivers a committed transition. Never called before the domain commit and outbox write. */
  async advance(ctx: WorkflowContext, signal: CommittedSignal): Promise<void> {
    this.assertOutsideDomainTx();
    assertCommitted(signal);
    if (signal.tenant_id !== ctx.tenant_id) throw new Cmp016Error('SF-TEN-002');
    await this.client.signal(
      temporalWorkflowId(signal.tenant_id, signal.application_id),
      SIGNAL_COMMITTED,
      signal,
    );
  }

  /** Delivers an approved, committed migration plan to a running execution. */
  async migrate(
    ctx: WorkflowContext,
    applicationId: string,
    target: ExecutableVersion,
    plan: MigrationPlan,
  ): Promise<void> {
    this.assertOutsideDomainTx();
    if (!isExecutable(target)) throw reject('VERSION_NOT_EXECUTABLE');
    if (plan.tenant_id !== ctx.tenant_id || target.tenant_id !== ctx.tenant_id) {
      throw new Cmp016Error('SF-TEN-002');
    }
    const payload: MigrateSignal = {
      plan,
      target: { version_id: target.version_id, model: target.model },
    };
    await this.client.signal(
      temporalWorkflowId(ctx.tenant_id, applicationId),
      SIGNAL_MIGRATE,
      payload,
    );
  }
}
