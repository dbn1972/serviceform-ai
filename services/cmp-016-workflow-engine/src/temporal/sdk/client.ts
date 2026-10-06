import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  type ConnectionOptions,
} from '@temporalio/client';
import { Cmp016Error, reject } from '../../errors.js';
import { isUuid } from '../../domain/model.js';
import type { TemporalClientPort } from '../../ports.js';
import { SIGNAL_COMMITTED, SIGNAL_MIGRATE, WORKFLOW_TYPE } from '../adapter.js';

const ALLOWED_SIGNALS = new Set([SIGNAL_COMMITTED, SIGNAL_MIGRATE]);
const TASK_QUEUE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789.-_';

function validTaskQueue(q: string): boolean {
  return q.length >= 3 && q.length <= 100 && [...q].every((c) => TASK_QUEUE_CHARS.includes(c));
}

/** `sf-wf:<tenant uuid>:<application uuid>`; one execution per tenant + application. */
function validWorkflowId(id: string): boolean {
  const parts = id.split(':');
  return parts.length === 3 && parts[0] === 'sf-wf' && isUuid(parts[1]) && isUuid(parts[2]);
}

function mapTemporalError(err: unknown): Cmp016Error {
  if (err instanceof Cmp016Error) return err;
  if (err instanceof WorkflowExecutionAlreadyStartedError) {
    return new Cmp016Error('SF-WF-001', [{ code: 'WORKFLOW_ALREADY_STARTED' }], { cause: err });
  }
  if (err instanceof WorkflowNotFoundError) {
    return new Cmp016Error('SF-WF-001', [{ code: 'WORKFLOW_NOT_RUNNING' }], { cause: err });
  }
  return new Cmp016Error('SF-SYS-004', [{ code: 'TEMPORAL_UNAVAILABLE' }], { cause: err });
}

/**
 * Production TemporalClientPort over the Temporal TypeScript SDK. Fail-closed: only the canonical
 * workflow type, the configured task queue, well-formed tenant+application workflow ids and the
 * two committed-signal names are accepted. A duplicate start is rejected (REJECT_DUPLICATE +
 * FAIL), never silently attached to or restarting an existing execution.
 */
export class TemporalSdkClient implements TemporalClientPort {
  constructor(
    private readonly client: Client,
    private readonly taskQueue: string,
  ) {
    if (!validTaskQueue(taskQueue))
      throw new Cmp016Error('SF-SYS-003', [{ code: 'TASK_QUEUE_INVALID' }]);
  }

  async start(request: {
    workflowId: string;
    taskQueue: string;
    workflowType: string;
    args: unknown[];
  }): Promise<{ runId: string }> {
    if (request.workflowType !== WORKFLOW_TYPE) throw reject('WORKFLOW_TYPE_NOT_ALLOWED');
    if (request.taskQueue !== this.taskQueue) throw reject('TASK_QUEUE_MISMATCH');
    if (!validWorkflowId(request.workflowId)) throw reject('WORKFLOW_ID_INVALID');
    try {
      const handle = await this.client.workflow.start(WORKFLOW_TYPE, {
        workflowId: request.workflowId,
        taskQueue: this.taskQueue,
        args: request.args,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
      });
      return { runId: handle.firstExecutionRunId };
    } catch (err) {
      throw mapTemporalError(err);
    }
  }

  async signal(workflowId: string, signalName: string, payload: unknown): Promise<void> {
    if (!ALLOWED_SIGNALS.has(signalName)) throw reject('SIGNAL_NOT_ALLOWED');
    if (!validWorkflowId(workflowId)) throw reject('WORKFLOW_ID_INVALID');
    try {
      await this.client.workflow.getHandle(workflowId).signal(signalName, payload);
    } catch (err) {
      throw mapTemporalError(err);
    }
  }
}

export async function connectTemporalClient(options: {
  address: string;
  namespace: string;
  taskQueue: string;
  tls?: ConnectionOptions['tls'];
}): Promise<TemporalSdkClient> {
  const connection = await Connection.connect({
    address: options.address,
    ...(options.tls === undefined ? {} : { tls: options.tls }),
  });
  return new TemporalSdkClient(
    new Client({ connection, namespace: options.namespace }),
    options.taskQueue,
  );
}
