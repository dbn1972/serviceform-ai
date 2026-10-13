import type { RequestContext } from '@serviceform/contracts';
import { Cmp046Error } from '../../../../services/cmp-046-operational-dashboard/src/errors.js';
import type {
  OpsRepository,
  OpsTx,
  RefreshLogRow,
  SnapshotRow,
} from '../../../../services/cmp-046-operational-dashboard/src/repo/types.js';
import type {
  DbSession,
  SearchDocumentRow,
  SearchStore,
  SearchTx,
} from '../../../../services/cmp-035-search-indexing/src/store/types.js';
import {
  claim,
  complete,
  TenantPartitionedStore,
  type IdemRow,
  type OutboxRow,
} from './fixtures.js';

export interface OpsTenantStore {
  snapshots: SnapshotRow[];
  refreshLog: RefreshLogRow[];
  idem: Map<string, IdemRow>;
  outbox: OutboxRow[];
}

export class InMemoryOpsRepository implements OpsRepository {
  readonly store = new TenantPartitionedStore<OpsTenantStore>(() => ({
    snapshots: [],
    refreshLog: [],
    idem: new Map(),
    outbox: [],
  }));

  inTransaction(): boolean {
    return this.store.inTransaction();
  }

  withTx<T>(ctx: RequestContext, fn: (tx: OpsTx) => Promise<T>): Promise<T> {
    return this.store.run(ctx, (s) => {
      const find = (code: string) => s.snapshots.find((r) => r.view_code === code);
      const tx: OpsTx = {
        claimIdempotency: async (p) => claim(s.idem, p, () => new Cmp046Error('SF-APP-002')),
        completeIdempotency: async (p) => complete(s.idem, p),
        getSnapshot: async (code) => structuredClone(find(code)),
        getSnapshotForUpdate: async (code) => structuredClone(find(code)),
        listSnapshots: async () => structuredClone(s.snapshots),
        insertSnapshot: async (row) => {
          s.snapshots.push(structuredClone(row));
        },
        updateSnapshot: async (row) => {
          const i = s.snapshots.findIndex((r) => r.snapshot_id === row.snapshot_id);
          s.snapshots[i] = structuredClone(row);
        },
        insertRefreshLog: async (row) => {
          s.refreshLog.push(structuredClone(row));
        },
        insertOutbox: async (envelope, topic) => {
          s.outbox.push({ topic, envelope: structuredClone(envelope) });
        },
      };
      return fn(tx);
    });
  }
}

export interface SearchTenantStore {
  docs: SearchDocumentRow[];
  inbox: string[];
  outbox: OutboxRow[];
}

/** Tenant-partitioned stand-in for sf_search under the indexer's DB session. */
export class InMemorySearchStore implements SearchStore {
  readonly sessions: DbSession[] = [];
  private readonly parts = new Map<string, SearchTenantStore>();

  tenant(id: string): SearchTenantStore {
    let p = this.parts.get(id);
    if (!p) {
      p = { docs: [], inbox: [], outbox: [] };
      this.parts.set(id, p);
    }
    return p;
  }

  tenants(): string[] {
    return [...this.parts.keys()];
  }

  async withTx<T>(session: DbSession, fn: (tx: SearchTx) => Promise<T>): Promise<T> {
    this.sessions.push({ ...session });
    const s = this.tenant(session.tenantId);
    const tx: SearchTx = {
      recordInbox: async (group, eventId) => {
        const k = `${group}|${eventId}`;
        if (s.inbox.includes(k)) return false;
        s.inbox.push(k);
        return true;
      },
      getDocumentBySource: async (cmp, rec) =>
        structuredClone(
          s.docs.find((d) => d.source_cmp_id === cmp && d.source_record_id === rec) ?? null,
        ),
      getDocument: async (id) => structuredClone(s.docs.find((d) => d.document_id === id) ?? null),
      insertDocument: async (row) => {
        s.docs.push(structuredClone(row));
      },
      updateDocument: async (u) => {
        const d = s.docs.find((x) => x.document_id === u.documentId);
        if (!d || d.revision !== u.fromRevision) return false;
        Object.assign(d, {
          source_version: u.sourceVersion,
          source_event_id: u.sourceEventId,
          facets: structuredClone(u.facets),
          status: u.status,
          revision: d.revision + 1,
          updated_at: u.updatedAt,
        });
        return true;
      },
      queryDocuments: async () => structuredClone(s.docs),
      insertOutbox: async (envelope, topic) => {
        s.outbox.push({ topic, envelope: structuredClone(envelope) });
      },
    };
    return fn(tx);
  }
}
