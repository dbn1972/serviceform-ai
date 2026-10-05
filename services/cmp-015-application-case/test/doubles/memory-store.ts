import type { EventEnvelope } from '../../src/domain/validate.js';
import { Cmp015Error, mapPgError } from '../../src/errors.js';
import type {
  CaseRow,
  CaseStore,
  CaseTx,
  DbSession,
  IdempotencyKeyRef,
  IdempotencyLookup,
  RequestRow,
  StoredResponse,
  TransitionRow,
} from '../../src/store/types.js';

interface IdemRow {
  fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response: StoredResponse | null;
}

export interface OutboxRow {
  tenant_id: string;
  topic: string;
  envelope: EventEnvelope<object>;
}

export interface State {
  cases: Map<string, CaseRow>;
  transitions: TransitionRow[];
  requests: Map<string, RequestRow>;
  idem: Map<string, IdemRow>;
  outbox: OutboxRow[];
}

function clone(s: State): State {
  return structuredClone(s);
}

/**
 * Transactional in-memory CaseStore for unit tests. Every transaction works on a copy that is
 * published only on commit; rows of other tenants are invisible (mirrors FORCE RLS).
 */
export class MemoryCaseStore implements CaseStore {
  state: State = {
    cases: new Map(),
    transitions: [],
    requests: new Map(),
    idem: new Map(),
    outbox: [],
  };
  sessions: DbSession[] = [];
  txCount = 0;
  hooks: {
    beforeCommit?: (session: DbSession) => Promise<void>;
    onOutbox?: (env: EventEnvelope<object>, topic: string) => Promise<void>;
    beforeLockCase?: (applicationId: string, work: State) => void;
  } = {};

  async withTx<T>(session: DbSession, fn: (tx: CaseTx) => Promise<T>): Promise<T> {
    this.txCount += 1;
    this.sessions.push(session);
    const work = clone(this.state);
    try {
      const result = await fn(new MemoryTx(work, session, this));
      if (this.hooks.beforeCommit) await this.hooks.beforeCommit(session);
      this.state = work;
      return result;
    } catch (err) {
      throw mapPgError(err);
    }
  }

  outboxFor(tenantId: string, topic?: string): OutboxRow[] {
    return this.state.outbox.filter(
      (o) => o.tenant_id === tenantId && (topic === undefined || o.topic === topic),
    );
  }
}

class MemoryTx implements CaseTx {
  constructor(
    private readonly s: State,
    private readonly session: DbSession,
    private readonly owner: MemoryCaseStore,
  ) {}

  private idemKey(ref: IdempotencyKeyRef): string {
    return `${this.session.tenantId}|${ref.principalId}|${ref.endpoint}|${ref.key}`;
  }

  private visible<T extends { tenant_id: string }>(row: T | undefined): T | null {
    return row && row.tenant_id === this.session.tenantId ? structuredClone(row) : null;
  }

  async lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup> {
    const row = this.s.idem.get(this.idemKey(ref));
    if (!row) return { state: 'absent' };
    if (row.status === 'COMPLETED' && row.response) {
      return {
        state: 'completed',
        fingerprint: row.fingerprint,
        response: structuredClone(row.response),
      };
    }
    return { state: 'pending', fingerprint: row.fingerprint };
  }

  async claimIdempotency(
    ref: IdempotencyKeyRef & { fingerprint: string; now: Date },
  ): Promise<'claimed' | StoredResponse> {
    const k = this.idemKey(ref);
    const row = this.s.idem.get(k);
    if (!row) {
      this.s.idem.set(k, { fingerprint: ref.fingerprint, status: 'IN_PROGRESS', response: null });
      return 'claimed';
    }
    if (row.fingerprint !== ref.fingerprint) throw new Cmp015Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response) return structuredClone(row.response);
    throw new Cmp015Error('SF-APP-002');
  }

  async completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void> {
    const row = this.s.idem.get(this.idemKey(ref));
    if (row) {
      row.status = 'COMPLETED';
      row.response = structuredClone(ref.response);
    }
  }

  async insertCase(row: CaseRow): Promise<void> {
    if (row.tenant_id !== this.session.tenantId)
      throw Object.assign(new Error('rls'), { code: '42501' });
    if (this.s.cases.has(row.application_id))
      throw Object.assign(new Error('dup'), { code: '23505' });
    this.s.cases.set(row.application_id, structuredClone(row));
  }

  async getCase(
    applicationId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<CaseRow | null> {
    if (opts.forUpdate && this.owner.hooks.beforeLockCase) {
      this.owner.hooks.beforeLockCase(applicationId, this.s);
    }
    return this.visible(this.s.cases.get(applicationId));
  }

  async updateCaseState(params: {
    applicationId: string;
    fromState: CaseRow['state'];
    toState: CaseRow['state'];
    fromVersion: number;
    updatedAt: string;
    submittedAt: string | null;
    correlationId: string;
  }): Promise<boolean> {
    const row = this.s.cases.get(params.applicationId);
    if (!row || row.tenant_id !== this.session.tenantId) return false;
    if (row.state !== params.fromState || row.aggregate_version !== params.fromVersion)
      return false;
    row.state = params.toState;
    row.aggregate_version += 1;
    row.updated_at = params.updatedAt;
    row.submitted_at = params.submittedAt ?? row.submitted_at;
    row.last_correlation_id = params.correlationId;
    return true;
  }

  async insertTransition(row: TransitionRow): Promise<void> {
    if (row.tenant_id !== this.session.tenantId)
      throw Object.assign(new Error('rls'), { code: '42501' });
    this.s.transitions.push(structuredClone(row));
  }

  async listTransitions(applicationId: string): Promise<TransitionRow[]> {
    return this.s.transitions
      .filter((t) => t.application_id === applicationId && t.tenant_id === this.session.tenantId)
      .map((t) => structuredClone(t));
  }

  async insertRequest(row: RequestRow): Promise<void> {
    if (row.tenant_id !== this.session.tenantId)
      throw Object.assign(new Error('rls'), { code: '42501' });
    const open = [...this.s.requests.values()].some(
      (r) =>
        r.application_id === row.application_id &&
        r.kind === row.kind &&
        (r.status === 'SUBMITTED' ||
          r.status === 'UNDER_REVIEW' ||
          (r.status === 'COMMITTED' && r.consumed_at_version === null)),
    );
    if (open) throw Object.assign(new Error('dup'), { code: '23505' });
    this.s.requests.set(row.request_id, structuredClone(row));
  }

  async getRequest(requestId: string): Promise<RequestRow | null> {
    return this.visible(this.s.requests.get(requestId));
  }

  async updateRequestStatus(params: {
    requestId: string;
    fromStatus: RequestRow['status'];
    toStatus: RequestRow['status'];
    reasonCode: string | null;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const row = this.s.requests.get(params.requestId);
    if (!row || row.tenant_id !== this.session.tenantId || row.status !== params.fromStatus)
      return false;
    row.status = params.toStatus;
    row.status_reason_code = params.reasonCode;
    row.updated_at = params.updatedAt;
    row.last_correlation_id = params.correlationId;
    return true;
  }

  async consumeRequest(params: {
    requestId: string;
    atVersion: number;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const row = this.s.requests.get(params.requestId);
    if (!row || row.tenant_id !== this.session.tenantId) return false;
    if (row.status !== 'COMMITTED' || row.consumed_at_version !== null) return false;
    row.consumed_at_version = params.atVersion;
    row.updated_at = params.updatedAt;
    row.last_correlation_id = params.correlationId;
    return true;
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    if (envelope.tenant_id !== this.session.tenantId)
      throw Object.assign(new Error('rls'), { code: '42501' });
    if (this.owner.hooks.onOutbox) await this.owner.hooks.onOutbox(envelope, topic);
    this.s.outbox.push({
      tenant_id: envelope.tenant_id,
      topic,
      envelope: structuredClone(envelope),
    });
  }
}
