import type { EventEnvelope } from '../../src/domain/validate.js';
import { Cmp035Error } from '../../src/errors.js';
import type {
  DbSession,
  DocumentQuery,
  DocumentUpdate,
  SearchDocumentRow,
  SearchStore,
  SearchTx,
} from '../../src/store/types.js';

export interface OutboxRow {
  tenant_id: string;
  topic: string;
  envelope: EventEnvelope<object>;
}

export interface State {
  documents: SearchDocumentRow[];
  inbox: { tenant_id: string; consumer_group: string; event_id: string }[];
  outbox: OutboxRow[];
}

/**
 * In-memory stand-in for sf_search. Emulates FORCE RLS: every read and write is limited to the
 * session tenant unless `bypassTenantFilter` simulates a broken isolation layer.
 */
export class MemorySearchStore implements SearchStore {
  state: State = { documents: [], inbox: [], outbox: [] };
  sessions: DbSession[] = [];
  bypassTenantFilter = false;
  hooks: { inTx?: () => Promise<void> } = {};

  async withTx<T>(session: DbSession, fn: (tx: SearchTx) => Promise<T>): Promise<T> {
    this.sessions.push(session);
    const work = structuredClone(this.state);
    const result = await fn(new MemoryTx(work, session, this));
    this.state = work;
    return result;
  }
}

function matchesFacets(row: SearchDocumentRow, facets: DocumentQuery['facets']): boolean {
  return Object.entries(facets).every(([k, v]) => row.facets[k] === v);
}

class MemoryTx implements SearchTx {
  constructor(
    private readonly s: State,
    private readonly session: DbSession,
    private readonly owner: MemorySearchStore,
  ) {}

  private visible(): SearchDocumentRow[] {
    if (this.owner.bypassTenantFilter) return this.s.documents;
    return this.s.documents.filter((d) => d.tenant_id === this.session.tenantId);
  }

  async recordInbox(consumerGroup: string, eventId: string): Promise<boolean> {
    await this.owner.hooks.inTx?.();
    if (this.s.inbox.some((r) => r.consumer_group === consumerGroup && r.event_id === eventId)) {
      return false;
    }
    this.s.inbox.push({
      tenant_id: this.session.tenantId,
      consumer_group: consumerGroup,
      event_id: eventId,
    });
    return true;
  }

  async getDocumentBySource(
    sourceCmpId: string,
    sourceRecordId: string,
  ): Promise<SearchDocumentRow | null> {
    const row = this.visible().find(
      (d) => d.source_cmp_id === sourceCmpId && d.source_record_id === sourceRecordId,
    );
    return row ? structuredClone(row) : null;
  }

  async getDocument(documentId: string): Promise<SearchDocumentRow | null> {
    const row = this.visible().find((d) => d.document_id === documentId);
    return row ? structuredClone(row) : null;
  }

  async insertDocument(row: SearchDocumentRow): Promise<void> {
    if (row.tenant_id !== this.session.tenantId) throw new Cmp035Error('SF-TEN-002');
    if (this.s.documents.some((d) => d.document_id === row.document_id)) {
      throw new Cmp035Error('SF-APP-002');
    }
    this.s.documents.push(structuredClone(row));
  }

  async updateDocument(u: DocumentUpdate): Promise<boolean> {
    const row = this.visible().find(
      (d) =>
        d.document_id === u.documentId &&
        d.revision === u.fromRevision &&
        d.source_version === u.fromSourceVersion,
    );
    if (!row) return false;
    Object.assign(row, {
      source_version: u.sourceVersion,
      source_event_id: u.sourceEventId,
      source_event_type: u.sourceEventType,
      source_occurred_at: u.sourceOccurredAt,
      projection_rule_id: u.projectionRuleId,
      projection_rule_version: u.projectionRuleVersion,
      facets: structuredClone(u.facets),
      status: u.status,
      revision: row.revision + 1,
      updated_at: u.updatedAt,
      last_correlation_id: u.correlationId,
    });
    return true;
  }

  async queryDocuments(q: DocumentQuery): Promise<SearchDocumentRow[]> {
    return this.visible()
      .filter(
        (d) =>
          d.status === 'ACTIVE' &&
          (q.sourceCmpId === null || d.source_cmp_id === q.sourceCmpId) &&
          matchesFacets(d, q.facets) &&
          (q.after === null || d.document_id > q.after),
      )
      .sort((a, b) => (a.document_id < b.document_id ? -1 : 1))
      .slice(0, q.limit)
      .map((d) => structuredClone(d));
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    if (envelope.tenant_id !== this.session.tenantId) throw new Cmp035Error('SF-TEN-002');
    this.s.outbox.push({
      tenant_id: this.session.tenantId,
      topic,
      envelope: structuredClone(envelope),
    });
  }
}
