import type {
  ApprovalPort,
  AuthorizationPort,
  HumanTaskPort,
  ProcessPort,
  RuleEvaluationPort,
  ServiceActivityPort,
  TemporalClientPort,
  TimerPolicyPort,
  WorkflowContext,
} from '../../src/index.js';
import { ACTOR, CHECKER, T1 } from '../fixtures/models.js';

export function ctx(over: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    tenant_id: T1,
    cell_id: 'cell-local-1',
    actor: { type: 'OFFICER', id: ACTOR },
    correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    ...over,
  };
}

export class RecordingTemporal implements TemporalClientPort {
  readonly calls: {
    op: 'start' | 'signal';
    workflowId: string;
    name?: string;
    payload?: unknown;
  }[] = [];
  failNext = false;

  constructor(private readonly log?: string[]) {}

  async start(request: {
    workflowId: string;
    taskQueue: string;
    workflowType: string;
    args: unknown[];
  }) {
    this.log?.push('TEMPORAL:start');
    if (this.failNext) {
      this.failNext = false;
      throw new Error('temporal unavailable');
    }
    this.calls.push({ op: 'start', workflowId: request.workflowId, payload: request });
    return { runId: 'run-1' };
  }

  async signal(workflowId: string, signalName: string, payload: unknown) {
    this.log?.push(`TEMPORAL:signal:${signalName}`);
    this.calls.push({ op: 'signal', workflowId, name: signalName, payload });
  }
}

export class Authz implements AuthorizationPort {
  readonly denied = new Set<string>();
  readonly seen: string[] = [];
  async authorize(_ctx: WorkflowContext, action: string) {
    this.seen.push(action);
    return {
      allow: !this.denied.has(action),
      decision_id: '99999999-9999-4999-8999-999999999999',
      policy_revision: 'rev-1',
    };
  }
}

export class Approvals implements ApprovalPort {
  approved = true;
  approver = CHECKER;
  readonly requests: unknown[] = [];
  async verify(_ctx: WorkflowContext, request: unknown) {
    this.requests.push(request);
    return { approved: this.approved, approver_id: this.approver };
  }
}

export class Ports {
  readonly log: string[] = [];
  readonly ruleOutcomes = new Map<string, string>();
  readonly humanTasks: HumanTaskPort = {
    create: async (_c, r) => {
      this.log.push(`task.create:${r.workflow_node_id}:${r.idempotency_key}`);
    },
    cancelClose: async (_c, r) => {
      this.log.push(`task.close:${r.workflow_node_id}`);
    },
  };
  readonly rules: RuleEvaluationPort = {
    evaluate: async (_c, r) => {
      this.log.push(`rule:${r.rule_ref}`);
      return { outcome: this.ruleOutcomes.get(r.node_id) ?? 'ELIGIBLE' };
    },
  };
  readonly activities: ServiceActivityPort = {
    invoke: async (_c, r) => {
      this.log.push(`activity:${r.node_id}`);
      return {};
    },
  };
  readonly processPorts: ProcessPort = {
    invoke: async (_c, r) => {
      this.log.push(`port:${r.port}:${r.node_id}`);
      return { outcome: 'DONE' };
    },
  };
  readonly timers: TimerPolicyPort = {
    durationMs: async (_c, r) => {
      this.log.push(`timer:${r.node_id}`);
      return 1000;
    },
  };
}
