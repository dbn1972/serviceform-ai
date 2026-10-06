import { Cmp018Error } from '../../src/errors.js';
import type { EventEnvelope } from '../../src/contracts.js';
import type { PrincipalScope } from '../../src/domain/resolution.js';
import type { ScheduleMeta } from '../../src/domain/scheduling.js';
import type {
  ChecklistRow,
  EvidenceRefRow,
  FindingRow,
  HistoryRow,
  InspectionPatch,
  InspectionReadTx,
  InspectionRepository,
  InspectionRow,
  InspectionWriteTx,
  NewHistory,
  NewInspection,
  ObservationRow,
  RepoContext,
  StoredIdempotent,
} from '../../src/repo/types.js';

interface State {
  inspections: Map<string, InspectionRow>;
  history: (HistoryRow & { tenant_id: string })[];
  checklist: (ChecklistRow & { tenant_id: string })[];
  observations: (ObservationRow & { tenant_id: string })[];
  evidence: (EvidenceRefRow & { tenant_id: string })[];
  findings: (FindingRow & { tenant_id: string })[];
  outbox: { tenant_id: string; topic: string; envelope: EventEnvelope<object> }[];
  idem: Map<string, { fingerprint: string; done: StoredIdempotent | null }>;
}

const key = (tenant: string, id: string): string => `${tenant}|${id}`;

function cloneState(s: State): State {
  return {
    inspections: new Map([...s.inspections].map(([k, v]) => [k, structuredClone(v)])),
    history: structuredClone(s.history),
    checklist: structuredClone(s.checklist),
    observations: structuredClone(s.observations),
    evidence: structuredClone(s.evidence),
    findings: structuredClone(s.findings),
    outbox: structuredClone(s.outbox),
    idem: new Map([...s.idem].map(([k, v]) => [k, structuredClone(v)])),
  };
}

export class MemoryInspectionRepository implements InspectionRepository {
  state: State = {
    inspections: new Map(),
    history: [],
    checklist: [],
    observations: [],
    evidence: [],
    findings: [],
    outbox: [],
    idem: new Map(),
  };

  read<T>(ctx: RepoContext, fn: (tx: InspectionReadTx) => Promise<T>): Promise<T> {
    return fn(new MemoryTx(this.state, ctx.tenant_id));
  }

  async write<T>(ctx: RepoContext, fn: (tx: InspectionWriteTx) => Promise<T>): Promise<T> {
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

class MemoryTx implements InspectionWriteTx {
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
      throw new Cmp018Error('SF-APP-002');
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

  async getInspection(inspectionId: string): Promise<InspectionRow | null> {
    const t = this.s.inspections.get(key(this.tenant, inspectionId));
    return t ? structuredClone(t) : null;
  }

  lockInspection(inspectionId: string): Promise<InspectionRow | null> {
    return this.getInspection(inspectionId);
  }

  async listAvailable(scope: PrincipalScope, limit: number): Promise<InspectionRow[]> {
    return [...this.s.inspections.values()]
      .filter(
        (t) =>
          t.tenant_id === this.tenant &&
          (t.inspection_state === 'REQUESTED' || t.inspection_state === 'SCHEDULED') &&
          scope.roles.includes(t.assignment.role_code) &&
          scope.organisation_ids.includes(t.assignment.organisation_id) &&
          (t.assignment.office_id === null || scope.office_ids.includes(t.assignment.office_id)) &&
          scope.jurisdiction_ids.includes(t.assignment.jurisdiction_id),
      )
      .slice(0, limit)
      .map((t) => structuredClone(t));
  }

  async listHistory(inspectionId: string): Promise<HistoryRow[]> {
    return this.s.history
      .filter((h) => h.tenant_id === this.tenant && h.inspection_id === inspectionId)
      .map(({ tenant_id: _t, ...rest }) => structuredClone(rest));
  }

  async listChecklist(inspectionId: string): Promise<ChecklistRow[]> {
    return this.s.checklist
      .filter((r) => r.tenant_id === this.tenant && r.inspection_id === inspectionId)
      .map(({ tenant_id: _t, ...rest }) => structuredClone(rest));
  }

  async listObservations(inspectionId: string): Promise<ObservationRow[]> {
    return this.s.observations
      .filter((r) => r.tenant_id === this.tenant && r.inspection_id === inspectionId)
      .map(({ tenant_id: _t, ...rest }) => structuredClone(rest));
  }

  async listEvidence(inspectionId: string): Promise<EvidenceRefRow[]> {
    return this.s.evidence
      .filter((r) => r.tenant_id === this.tenant && r.inspection_id === inspectionId)
      .map(({ tenant_id: _t, ...rest }) => structuredClone(rest));
  }

  async listFindings(inspectionId: string): Promise<FindingRow[]> {
    return this.s.findings
      .filter((r) => r.tenant_id === this.tenant && r.inspection_id === inspectionId)
      .map(({ tenant_id: _t, ...rest }) => structuredClone(rest));
  }

  async insertInspection(t: NewInspection): Promise<InspectionRow> {
    const row: InspectionRow = {
      tenant_id: this.tenant,
      inspection_id: t.inspection_id,
      application_id: t.application_id,
      prior_inspection_id: t.prior_inspection_id,
      workflow_node_id: t.workflow_node_id,
      cell_id: t.cell_id,
      inspection_state: 'REQUESTED',
      assignment: structuredClone(t.assignment),
      claimed_principal_id: null,
      claimed_at: null,
      schedule: {
        window_start: null,
        window_end: null,
        slot_ref: null,
        location_ref: null,
        timezone_iana: null,
      },
      verification_result: null,
      statutory_effect: false,
      created_by: t.created_by,
      correlation_id: t.correlation_id,
      aggregate_version: 1,
      created_at: t.now.toISOString(),
      updated_at: t.now.toISOString(),
    };
    this.s.inspections.set(key(this.tenant, t.inspection_id), row);
    return structuredClone(row);
  }

  async updateInspection(inspectionId: string, p: InspectionPatch): Promise<InspectionRow> {
    const row = this.s.inspections.get(key(this.tenant, inspectionId));
    if (!row || row.aggregate_version !== p.expected_version) throw new Cmp018Error('SF-APP-001');
    row.inspection_state = p.inspection_state;
    row.assignment = structuredClone(p.assignment);
    row.claimed_principal_id = p.claimed_principal_id;
    row.claimed_at = p.claimed_at ? p.claimed_at.toISOString() : null;
    row.schedule = {
      window_start: p.schedule.window_start ? p.schedule.window_start.toISOString() : null,
      window_end: p.schedule.window_end ? p.schedule.window_end.toISOString() : null,
      slot_ref: p.schedule.slot_ref,
      location_ref: p.schedule.location_ref,
      timezone_iana: p.schedule.timezone_iana,
    };
    row.verification_result = p.verification_result;
    row.aggregate_version += 1;
    row.updated_at = p.now.toISOString();
    return structuredClone(row);
  }

  async insertHistory(h: NewHistory): Promise<HistoryRow> {
    const seq =
      this.s.history.filter(
        (x) => x.tenant_id === this.tenant && x.inspection_id === h.inspection_id,
      ).length + 1;
    const { now, ...rest } = h;
    const row = { ...rest, seq, occurred_at: now.toISOString() };
    this.s.history.push({ ...row, tenant_id: this.tenant });
    return structuredClone(row);
  }

  async upsertChecklistItem(row: ChecklistRow & { now: Date }): Promise<ChecklistRow> {
    const existing = this.s.checklist.find(
      (x) =>
        x.tenant_id === this.tenant &&
        x.inspection_id === row.inspection_id &&
        x.item_code === row.item_code,
    );
    if (existing) {
      existing.item_state = row.item_state;
      return structuredClone(existing);
    }
    const stored = {
      item_id: row.item_id,
      inspection_id: row.inspection_id,
      item_code: row.item_code,
      required: row.required,
      item_state: row.item_state,
      tenant_id: this.tenant,
    };
    this.s.checklist.push(stored);
    const { tenant_id: _t, ...rest } = stored;
    return structuredClone(rest);
  }

  async insertObservation(row: ObservationRow & { captured_at: Date }): Promise<ObservationRow> {
    const stored = {
      observation_id: row.observation_id,
      inspection_id: row.inspection_id,
      item_code: row.item_code,
      note_ref: row.note_ref,
      geo_ref: row.geo_ref,
      captured_at: row.captured_at.toISOString(),
      actor_id: row.actor_id,
      tenant_id: this.tenant,
    };
    this.s.observations.push(stored);
    const { tenant_id: _t, ...rest } = stored;
    return structuredClone(rest);
  }

  async insertEvidenceRef(row: EvidenceRefRow): Promise<EvidenceRefRow> {
    const stored = { ...row, tenant_id: this.tenant };
    this.s.evidence.push(stored);
    const { tenant_id: _t, ...rest } = stored;
    return structuredClone(rest);
  }

  async insertFinding(row: FindingRow): Promise<FindingRow> {
    const stored = { ...row, tenant_id: this.tenant };
    this.s.findings.push(stored);
    const { tenant_id: _t, ...rest } = stored;
    return structuredClone(rest);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ tenant_id: this.tenant, topic, envelope: structuredClone(envelope) });
  }
}

export type { ScheduleMeta };
