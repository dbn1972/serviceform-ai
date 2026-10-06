import { Cmp017Error } from '../../src/errors.js';
import type { EventEnvelope } from '../../src/contracts.js';
import type { PrincipalScope } from '../../src/domain/resolution.js';
import type {
  HistoryRow,
  NewHistory,
  NewTask,
  RepoContext,
  StoredIdempotent,
  TaskPatch,
  TaskReadTx,
  TaskRepository,
  TaskRow,
  TaskWriteTx,
} from '../../src/repo/types.js';

interface State {
  tasks: Map<string, TaskRow>;
  history: (HistoryRow & { tenant_id: string })[];
  outbox: { tenant_id: string; topic: string; envelope: EventEnvelope<object> }[];
  idem: Map<string, { fingerprint: string; done: StoredIdempotent | null }>;
}

const key = (tenant: string, id: string): string => `${tenant}|${id}`;

function cloneState(s: State): State {
  return {
    tasks: new Map([...s.tasks].map(([k, v]) => [k, structuredClone(v)])),
    history: structuredClone(s.history),
    outbox: structuredClone(s.outbox),
    idem: new Map([...s.idem].map(([k, v]) => [k, structuredClone(v)])),
  };
}

/** In-memory double with the same tenant filtering and rollback semantics as the PG repository. */
export class MemoryTaskRepository implements TaskRepository {
  state: State = { tasks: new Map(), history: [], outbox: [], idem: new Map() };

  read<T>(ctx: RepoContext, fn: (tx: TaskReadTx) => Promise<T>): Promise<T> {
    return fn(new MemoryTx(this.state, ctx.tenant_id));
  }

  async write<T>(ctx: RepoContext, fn: (tx: TaskWriteTx) => Promise<T>): Promise<T> {
    const snapshot = cloneState(this.state);
    try {
      return await fn(new MemoryTx(this.state, ctx.tenant_id));
    } catch (err) {
      this.state = snapshot;
      throw err;
    }
  }

  outboxOf(topic: string): EventEnvelope<object>[] {
    return this.state.outbox.filter((o) => o.topic === topic).map((o) => o.envelope);
  }
}

class MemoryTx implements TaskWriteTx {
  constructor(
    private readonly s: State,
    private readonly tenant: string,
  ) {}

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const k = key(this.tenant, `${p.principalId}|${p.endpoint}|${p.key}`);
    const existing = this.s.idem.get(k);
    if (!existing) {
      this.s.idem.set(k, { fingerprint: p.fingerprint, done: null });
      return 'claimed';
    }
    if (existing.fingerprint !== p.fingerprint || !existing.done) {
      throw new Cmp017Error('SF-APP-002');
    }
    return existing.done;
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const rec = this.s.idem.get(key(this.tenant, `${p.principalId}|${p.endpoint}|${p.key}`));
    if (rec) rec.done = { status: p.status, body: structuredClone(p.body) };
  }

  async getTask(taskId: string): Promise<TaskRow | null> {
    const t = this.s.tasks.get(key(this.tenant, taskId));
    return t ? structuredClone(t) : null;
  }

  lockTask(taskId: string): Promise<TaskRow | null> {
    return this.getTask(taskId);
  }

  async listAvailable(scope: PrincipalScope, limit: number): Promise<TaskRow[]> {
    return [...this.s.tasks.values()]
      .filter(
        (t) =>
          t.tenant_id === this.tenant &&
          t.task_state === 'OPEN' &&
          scope.roles.includes(t.assignment.role_code) &&
          scope.organisation_ids.includes(t.assignment.organisation_id) &&
          (t.assignment.office_id === null || scope.office_ids.includes(t.assignment.office_id)) &&
          scope.jurisdiction_ids.includes(t.assignment.jurisdiction_id) &&
          (t.assignment.service_scope_id === null ||
            scope.service_scope_ids.includes(t.assignment.service_scope_id)),
      )
      .slice(0, limit)
      .map((t) => structuredClone(t));
  }

  async listHistory(taskId: string): Promise<HistoryRow[]> {
    return this.s.history
      .filter((h) => h.tenant_id === this.tenant && h.task_id === taskId)
      .map(({ tenant_id: _t, ...rest }) => structuredClone(rest));
  }

  async insertTask(t: NewTask): Promise<TaskRow> {
    const activeDuplicate =
      t.workflow_node_id !== null &&
      [...this.s.tasks.values()].some(
        (x) =>
          x.tenant_id === this.tenant &&
          x.application_id === t.application_id &&
          x.workflow_node_id === t.workflow_node_id &&
          (x.task_state === 'OPEN' || x.task_state === 'CLAIMED'),
      );
    if (activeDuplicate) throw new Cmp017Error('SF-APP-002');
    const row: TaskRow = {
      tenant_id: this.tenant,
      task_id: t.task_id,
      application_id: t.application_id,
      workflow_node_id: t.workflow_node_id,
      cell_id: t.cell_id,
      task_state: 'OPEN',
      assignment: structuredClone(t.assignment),
      claimed_principal_id: null,
      claimed_at: null,
      outcome: null,
      created_by: t.created_by,
      correlation_id: t.correlation_id,
      aggregate_version: 1,
      created_at: t.now.toISOString(),
      updated_at: t.now.toISOString(),
    };
    this.s.tasks.set(key(this.tenant, t.task_id), row);
    return structuredClone(row);
  }

  async updateTask(taskId: string, p: TaskPatch): Promise<TaskRow> {
    const row = this.s.tasks.get(key(this.tenant, taskId));
    if (!row || row.aggregate_version !== p.expected_version) throw new Cmp017Error('SF-APP-001');
    row.task_state = p.task_state;
    row.assignment = structuredClone(p.assignment);
    row.claimed_principal_id = p.claimed_principal_id;
    row.claimed_at = p.claimed_at ? p.claimed_at.toISOString() : null;
    row.outcome = p.outcome;
    row.aggregate_version += 1;
    row.updated_at = p.now.toISOString();
    return structuredClone(row);
  }

  async insertHistory(h: NewHistory): Promise<HistoryRow> {
    const seq =
      this.s.history.filter((x) => x.tenant_id === this.tenant && x.task_id === h.task_id).length +
      1;
    const { now, ...rest } = h;
    const row = { ...rest, seq, occurred_at: now.toISOString() };
    this.s.history.push({ ...row, tenant_id: this.tenant });
    return structuredClone(row);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ tenant_id: this.tenant, topic, envelope: structuredClone(envelope) });
  }
}
