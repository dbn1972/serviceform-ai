import type { EventEnvelope } from '../../src/domain/validate.js';
import { Cmp027Error, mapPgError } from '../../src/errors.js';
import type {
  AiAssistRow,
  AssignmentRequestRow,
  DbSession,
  GrievanceRow,
  GrievanceStore,
  GrievanceTx,
  IdempotencyKeyRef,
  IdempotencyLookup,
  ResponseRow,
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
  grievances: Map<string, GrievanceRow>;
  transitions: TransitionRow[];
  responses: ResponseRow[];
  assignments: Map<string, AssignmentRequestRow>;
  assists: AiAssistRow[];
  idem: Map<string, IdemRow>;
  outbox: OutboxRow[];
}

function clone(s: State): State {
  return structuredClone(s);
}

export class MemoryGrievanceStore implements GrievanceStore {
  state: State = {
    grievances: new Map(),
    transitions: [],
    responses: [],
    assignments: new Map(),
    assists: [],
    idem: new Map(),
    outbox: [],
  };
  txCount = 0;
  hooks: { onOutbox?: (env: EventEnvelope<object>, topic: string) => Promise<void> } = {};

  async withTx<T>(session: DbSession, fn: (tx: GrievanceTx) => Promise<T>): Promise<T> {
    this.txCount += 1;
    const work = clone(this.state);
    try {
      const result = await fn(new MemoryTx(work, session, this));
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

class MemoryTx implements GrievanceTx {
  constructor(
    private readonly s: State,
    private readonly session: DbSession,
    private readonly owner: MemoryGrievanceStore,
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
    if (row.fingerprint !== ref.fingerprint) throw new Cmp027Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response) return structuredClone(row.response);
    throw new Cmp027Error('SF-APP-002');
  }

  async completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void> {
    const row = this.s.idem.get(this.idemKey(ref));
    if (row) {
      row.status = 'COMPLETED';
      row.response = structuredClone(ref.response);
    }
  }

  async insertGrievance(row: GrievanceRow): Promise<void> {
    if (row.tenant_id !== this.session.tenantId)
      throw Object.assign(new Error('rls'), { code: '42501' });
    if (this.s.grievances.has(row.grievance_id))
      throw Object.assign(new Error('dup'), { code: '23505' });
    this.s.grievances.set(row.grievance_id, structuredClone(row));
  }

  async getGrievance(id: string): Promise<GrievanceRow | null> {
    return this.visible(this.s.grievances.get(id));
  }

  async updateGrievance(params: {
    grievanceId: string;
    fromStatus: GrievanceRow['status'];
    toStatus: GrievanceRow['status'];
    fromVersion: number;
    categoryCode: string | null;
    organisationId: string | null;
    jurisdictionId: string | null;
    officeId: string | null;
    workflowVersionId: string | null;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const row = this.s.grievances.get(params.grievanceId);
    if (!row || row.tenant_id !== this.session.tenantId) return false;
    if (row.status !== params.fromStatus || row.aggregate_version !== params.fromVersion)
      return false;
    row.status = params.toStatus;
    row.aggregate_version += 1;
    row.updated_at = params.updatedAt;
    row.last_correlation_id = params.correlationId;
    if (params.categoryCode) row.category_code = params.categoryCode;
    if (params.organisationId) row.organisation_id = params.organisationId;
    if (params.jurisdictionId) row.jurisdiction_id = params.jurisdictionId;
    if (params.officeId) row.office_id = params.officeId;
    if (params.workflowVersionId) row.workflow_version_id = params.workflowVersionId;
    return true;
  }

  async insertTransition(row: TransitionRow): Promise<void> {
    this.s.transitions.push(structuredClone(row));
  }

  async listTransitions(grievanceId: string): Promise<TransitionRow[]> {
    return this.s.transitions.filter(
      (t) => t.grievance_id === grievanceId && t.tenant_id === this.session.tenantId,
    );
  }

  async insertResponse(row: ResponseRow): Promise<void> {
    this.s.responses.push(structuredClone(row));
  }

  async listResponses(grievanceId: string): Promise<ResponseRow[]> {
    return this.s.responses.filter(
      (r) => r.grievance_id === grievanceId && r.tenant_id === this.session.tenantId,
    );
  }

  async insertAssignmentRequest(row: AssignmentRequestRow): Promise<void> {
    this.s.assignments.set(row.grievance_id, structuredClone(row));
  }

  async getAssignmentRequest(grievanceId: string): Promise<AssignmentRequestRow | null> {
    return this.visible(this.s.assignments.get(grievanceId));
  }

  async insertAiAssist(row: AiAssistRow): Promise<void> {
    this.s.assists.push(structuredClone(row));
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    if (this.owner.hooks.onOutbox) await this.owner.hooks.onOutbox(envelope, topic);
    const tenant = envelope.tenant_id;
    if (typeof tenant !== 'string') throw new Cmp027Error('SF-SYS-001');
    this.s.outbox.push({ tenant_id: tenant, topic, envelope });
  }
}
