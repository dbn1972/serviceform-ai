import { Cmp028Error } from '../../src/errors.js';
import type { EventEnvelope } from '../../src/contracts.js';
import { runInDomainTransaction } from '../../src/tx-scope.js';
import type {
  AppealPatch,
  AppealReadTx,
  AppealRepository,
  AppealRow,
  AppealWriteTx,
  AssistNoteRow,
  HistoryRow,
  NewAppeal,
  NewHistory,
  RepoContext,
  StoredIdempotent,
} from '../../src/repo/types.js';

interface State {
  appeals: Map<string, AppealRow>;
  history: (HistoryRow & { tenant_id: string })[];
  notes: (AssistNoteRow & { tenant_id: string })[];
  outbox: { tenant_id: string; topic: string; envelope: EventEnvelope<object> }[];
  idem: Map<string, { fingerprint: string; done: StoredIdempotent | null }>;
}

const key = (tenant: string, id: string): string => `${tenant}|${id}`;
const iso = (d: Date): string => d.toISOString();

function cloneState(s: State): State {
  return {
    appeals: new Map([...s.appeals].map(([k, v]) => [k, structuredClone(v)])),
    history: structuredClone(s.history),
    notes: structuredClone(s.notes),
    outbox: structuredClone(s.outbox),
    idem: new Map([...s.idem].map(([k, v]) => [k, structuredClone(v)])),
  };
}

export class MemoryAppealRepository implements AppealRepository {
  state: State = { appeals: new Map(), history: [], notes: [], outbox: [], idem: new Map() };

  read<T>(ctx: RepoContext, fn: (tx: AppealReadTx) => Promise<T>): Promise<T> {
    return runInDomainTransaction(() => fn(new MemoryTx(this.state, ctx.tenant_id)));
  }

  async write<T>(ctx: RepoContext, fn: (tx: AppealWriteTx) => Promise<T>): Promise<T> {
    const snapshot = cloneState(this.state);
    try {
      return await runInDomainTransaction(() => fn(new MemoryTx(this.state, ctx.tenant_id)));
    } catch (err) {
      this.state = snapshot;
      throw err;
    }
  }

  outboxOf(topic: string): EventEnvelope<object>[] {
    return this.state.outbox.filter((o) => o.topic === topic).map((o) => o.envelope);
  }
}

class MemoryTx implements AppealWriteTx {
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
      throw new Cmp028Error('SF-APP-002');
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
    const k = key(this.tenant, `${p.principalId}|${p.endpoint}|${p.key}`);
    this.s.idem.set(k, {
      fingerprint: this.s.idem.get(k)?.fingerprint ?? '',
      done: { status: p.status, body: p.body },
    });
  }

  async getAppeal(appealId: string): Promise<AppealRow | null> {
    return this.s.appeals.get(key(this.tenant, appealId)) ?? null;
  }

  async lockAppeal(appealId: string): Promise<AppealRow | null> {
    return this.getAppeal(appealId);
  }

  async listHistory(appealId: string): Promise<HistoryRow[]> {
    return this.s.history
      .filter((h) => h.tenant_id === this.tenant && h.appeal_id === appealId)
      .sort((a, b) => a.seq - b.seq);
  }

  async listNotes(appealId: string): Promise<AssistNoteRow[]> {
    return this.s.notes.filter((n) => n.tenant_id === this.tenant && n.appeal_id === appealId);
  }

  async insertAppeal(t: NewAppeal): Promise<AppealRow> {
    const row: AppealRow = {
      tenant_id: this.tenant,
      appeal_id: t.appeal_id,
      original_application_id: t.original_application_id,
      original_case_id: t.original_case_id,
      original_decision_id: t.original_decision_id,
      cell_id: t.cell_id,
      appeal_state: 'FILED',
      grounds_code: t.grounds_code,
      evidence_refs: t.evidence_refs,
      admissibility_code: 'PENDING',
      admissibility_reason_code: null,
      authority: t.authority,
      workflow_instance_id: null,
      workflow_version_id: null,
      hearing_ref: null,
      review_ref: null,
      decision_ref: null,
      original_case_command_ref: null,
      created_by: t.created_by,
      correlation_id: t.correlation_id,
      aggregate_version: 1,
      created_at: iso(t.now),
      updated_at: iso(t.now),
    };
    this.s.appeals.set(key(this.tenant, t.appeal_id), row);
    return structuredClone(row);
  }

  async updateAppeal(appealId: string, p: AppealPatch): Promise<AppealRow> {
    const cur = this.s.appeals.get(key(this.tenant, appealId));
    if (!cur || cur.aggregate_version !== p.expected_version) throw new Cmp028Error('SF-APP-001');
    const next: AppealRow = {
      ...cur,
      appeal_state: p.appeal_state,
      admissibility_code: p.admissibility_code,
      admissibility_reason_code: p.admissibility_reason_code,
      authority: p.authority,
      workflow_instance_id: p.workflow_instance_id,
      workflow_version_id: p.workflow_version_id,
      hearing_ref: p.hearing_ref,
      review_ref: p.review_ref,
      decision_ref: p.decision_ref,
      original_case_command_ref: p.original_case_command_ref,
      original_case_id: p.original_case_id,
      original_decision_id: p.original_decision_id,
      evidence_refs: p.evidence_refs,
      aggregate_version: cur.aggregate_version + 1,
      updated_at: iso(p.now),
    };
    this.s.appeals.set(key(this.tenant, appealId), next);
    return structuredClone(next);
  }

  async insertHistory(h: NewHistory): Promise<HistoryRow> {
    const seq =
      this.s.history.filter((x) => x.tenant_id === this.tenant && x.appeal_id === h.appeal_id)
        .length + 1;
    const row: HistoryRow & { tenant_id: string } = {
      ...h,
      seq,
      occurred_at: iso(h.now),
      tenant_id: this.tenant,
    };
    this.s.history.push(row);
    return structuredClone(row);
  }

  async insertNote(row: {
    note_id: string;
    appeal_id: string;
    note_kind: AssistNoteRow['note_kind'];
    content_ref: string;
    created_by: string;
    now: Date;
  }): Promise<AssistNoteRow> {
    const n: AssistNoteRow & { tenant_id: string } = {
      note_id: row.note_id,
      appeal_id: row.appeal_id,
      note_kind: row.note_kind,
      content_ref: row.content_ref,
      created_by: row.created_by,
      created_at: iso(row.now),
      tenant_id: this.tenant,
    };
    this.s.notes.push(n);
    return structuredClone(n);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ tenant_id: this.tenant, topic, envelope });
  }
}
