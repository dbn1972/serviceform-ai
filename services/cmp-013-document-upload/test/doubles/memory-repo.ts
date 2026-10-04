import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventEnvelope, RequestContext } from '@serviceform/contracts';
import type { UploadPolicy } from '../../src/domain/policy.js';
import { Cmp013Error } from '../../src/errors.js';
import type {
  DocumentPatch,
  DocumentRow,
  NewDocument,
  ScanRow,
  SessionRow,
  StoredIdempotent,
  UploadRepository,
  UploadTx,
} from '../../src/repo/types.js';

interface IdemRow {
  tenant_id: string;
  principal_id: string;
  endpoint: string;
  key: string;
  fingerprint: string;
  status: number | null;
  body: unknown;
}

export interface MemoryState {
  policies: (UploadPolicy & { tenant_id: string })[];
  documents: DocumentRow[];
  sessions: SessionRow[];
  scans: (ScanRow & { tenant_id: string })[];
  idem: IdemRow[];
  inbox: { tenant_id: string; group: string; event_id: string }[];
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

export function emptyState(): MemoryState {
  return { policies: [], documents: [], sessions: [], scans: [], idem: [], inbox: [], outbox: [] };
}

/** In-memory analogue of FORCE RLS: every read/write is filtered by the tx tenant. */
class MemoryTx implements UploadTx {
  constructor(
    private readonly s: MemoryState,
    private readonly tenant: string,
  ) {}

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const row = this.s.idem.find(
      (r) =>
        r.tenant_id === this.tenant &&
        r.principal_id === p.principalId &&
        r.endpoint === p.endpoint &&
        r.key === p.key,
    );
    if (!row) {
      this.s.idem.push({
        tenant_id: this.tenant,
        principal_id: p.principalId,
        endpoint: p.endpoint,
        key: p.key,
        fingerprint: p.fingerprint,
        status: null,
        body: null,
      });
      return 'claimed';
    }
    if (row.fingerprint !== p.fingerprint || row.status === null) {
      throw new Cmp013Error('SF-APP-002');
    }
    return { status: row.status, body: structuredClone(row.body) };
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const row = this.s.idem.find(
      (r) =>
        r.tenant_id === this.tenant &&
        r.principal_id === p.principalId &&
        r.endpoint === p.endpoint &&
        r.key === p.key,
    );
    if (row) {
      row.status = p.status;
      row.body = structuredClone(p.body);
    }
  }

  async latestPolicy(code: string): Promise<UploadPolicy | null> {
    const rows = this.s.policies
      .filter((p) => p.tenant_id === this.tenant && p.policy_code === code)
      .sort((a, b) => b.version_no - a.version_no);
    return rows[0] ? structuredClone(rows[0]) : null;
  }

  async policyById(id: string): Promise<UploadPolicy | null> {
    const row = this.s.policies.find((p) => p.tenant_id === this.tenant && p.policy_id === id);
    return row ? structuredClone(row) : null;
  }

  async insertPolicy(row: UploadPolicy & { created_by: string }): Promise<void> {
    if (
      this.s.policies.some(
        (p) =>
          p.tenant_id === this.tenant &&
          p.policy_code === row.policy_code &&
          p.version_no === row.version_no,
      )
    ) {
      throw Object.assign(new Error('dup'), { code: '23505' });
    }
    const { created_by: _createdBy, ...policy } = row;
    this.s.policies.push({ ...policy, tenant_id: this.tenant });
  }

  async insertDocument(row: NewDocument): Promise<void> {
    if (row.tenant_id !== this.tenant) throw Object.assign(new Error('rls'), { code: '42501' });
    const { now, ...rest } = row;
    this.s.documents.push({
      ...rest,
      detected_content_type: null,
      byte_size: null,
      checksum_sha256: null,
      status: 'PENDING_UPLOAD',
      rejection_code: null,
      scan_attempts: 0,
      aggregate_version: 1,
      created_at: now,
      updated_at: now,
    });
  }

  async insertSession(row: Omit<SessionRow, 'tenant_id' | 'closed_at' | 'status'>): Promise<void> {
    this.s.sessions.push({ ...row, tenant_id: this.tenant, status: 'OPEN', closed_at: null });
  }

  private doc(id: string): DocumentRow | undefined {
    return this.s.documents.find((d) => d.tenant_id === this.tenant && d.document_id === id);
  }

  async getDocument(id: string): Promise<DocumentRow | null> {
    const d = this.doc(id);
    return d ? structuredClone(d) : null;
  }

  async getSessionForDocument(id: string): Promise<SessionRow | null> {
    const s = this.s.sessions.find((r) => r.tenant_id === this.tenant && r.document_id === id);
    return s ? structuredClone(s) : null;
  }

  async updateDocument(id: string, patch: DocumentPatch): Promise<number> {
    const d = this.doc(id);
    if (!d) throw new Cmp013Error('SF-SYS-002');
    if (patch.status === 'AVAILABLE') {
      const clean = this.s.scans.some(
        (s) => s.tenant_id === this.tenant && s.document_id === id && s.verdict === 'CLEAN',
      );
      if (!clean) throw Object.assign(new Error('guard'), { code: 'P0001' });
    }
    d.status = patch.status;
    if (patch.rejection_code !== undefined) d.rejection_code = patch.rejection_code;
    if (patch.detected_content_type !== undefined)
      d.detected_content_type = patch.detected_content_type;
    if (patch.byte_size !== undefined) d.byte_size = patch.byte_size;
    if (patch.checksum_sha256 !== undefined) d.checksum_sha256 = patch.checksum_sha256;
    if (patch.scan_attempts !== undefined) d.scan_attempts = patch.scan_attempts;
    d.aggregate_version += 1;
    d.updated_at = patch.now;
    return d.aggregate_version;
  }

  async closeSession(
    id: string,
    status: 'COMPLETED' | 'EXPIRED' | 'REJECTED',
    now: string,
  ): Promise<void> {
    const s = this.s.sessions.find(
      (r) => r.tenant_id === this.tenant && r.session_id === id && r.status === 'OPEN',
    );
    if (s) {
      s.status = status;
      s.closed_at = now;
    }
  }

  async insertScan(row: ScanRow): Promise<void> {
    this.s.scans.push({ ...row, tenant_id: this.tenant });
  }

  async recordInbox(group: string, eventId: string): Promise<boolean> {
    if (this.s.inbox.some((r) => r.group === group && r.event_id === eventId)) return false;
    this.s.inbox.push({ tenant_id: this.tenant, group, event_id: eventId });
    return true;
  }

  async inboxSeen(group: string, eventId: string): Promise<boolean> {
    return this.s.inbox.some(
      (r) => r.tenant_id === this.tenant && r.group === group && r.event_id === eventId,
    );
  }

  async openExpiredSessions(now: string, limit: number): Promise<SessionRow[]> {
    return this.s.sessions
      .filter(
        (r) =>
          r.tenant_id === this.tenant &&
          r.status === 'OPEN' &&
          Date.parse(r.expires_at) <= Date.parse(now),
      )
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    if (envelope.tenant_id !== this.tenant) {
      throw Object.assign(new Error('rls'), { code: '42501' });
    }
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
  }
}

export class MemoryUploadRepository implements UploadRepository {
  private readonly als = new AsyncLocalStorage<true>();
  transactions = 0;

  constructor(readonly state: MemoryState = emptyState()) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: UploadTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp013Error('SF-TEN-001');
    const tenant = ctx.tenant_id;
    const snapshot = structuredClone(this.state);
    this.transactions += 1;
    try {
      return await this.als.run(true, () => fn(new MemoryTx(this.state, tenant)));
    } catch (err) {
      Object.assign(this.state, snapshot);
      throw err;
    }
  }

  events(type?: string): EventEnvelope<object>[] {
    return this.state.outbox
      .filter((o) => o.topic === 'sf.upload.events.v1')
      .map((o) => o.envelope)
      .filter((e) => type === undefined || e.event_type === type);
  }
}
