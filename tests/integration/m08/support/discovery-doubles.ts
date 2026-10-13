import type { RequestContext } from '@serviceform/contracts';
import { Cmp006Error } from '../../../../services/cmp-006-service-discovery/src/errors.js';
import type {
  CatalogueEntry,
  CataloguePort,
  CatalogueVersionPin,
} from '../../../../services/cmp-006-service-discovery/src/ports/catalogue-port.js';
import type {
  JurisdictionPort,
  JurisdictionResolution,
} from '../../../../services/cmp-006-service-discovery/src/ports/jurisdiction-port.js';
import type {
  SearchCandidate,
  SearchPort,
} from '../../../../services/cmp-006-service-discovery/src/ports/search-port.js';
import type {
  DiscoveryQueryRecord,
  DiscoveryRepository,
  DiscoveryResultRecord,
  DiscoverySelectionRecord,
  DiscoveryTx,
} from '../../../../services/cmp-006-service-discovery/src/repo/types.js';
import {
  claim,
  complete,
  T1,
  T2,
  TenantPartitionedStore,
  type IdemRow,
  type OutboxRow,
} from './fixtures.js';

export const CAT_T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CAT_T1_DRAFT = 'abababab-abab-4bab-8bab-abababababab';
export const CAT_T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SVC_T1_A = 'c1111111-1111-4111-8111-111111111111';
export const SVC_T1_B = 'c2222222-2222-4222-8222-222222222222';
export const SVC_T2_A = 'cb111111-1111-4111-8111-111111111111';
export const BIND_T1_A = 'd1111111-1111-4111-8111-111111111111';
export const BIND_T1_B = 'd2222222-2222-4222-8222-222222222222';
export const BIND_T2_A = 'db111111-1111-4111-8111-111111111111';
export const JUR_REGION = 'JUR-R';
export const JUR_DISTRICT = 'JUR-R-01';
export const JUR_ELSEWHERE = 'JUR-Z';

function entry(
  tenant: string,
  catalogue: string,
  id: string,
  code: string,
  binding: string,
  jurisdictions: string[],
): CatalogueEntry {
  return {
    tenant_id: tenant,
    catalogue_version_id: catalogue,
    service_id: id,
    service_code: code,
    category_code: 'CAT_SYNTHETIC',
    service_binding_version_id: binding,
    label_key: `svc.${code}.name`,
    jurisdiction_codes: jurisdictions,
    status: 'PUBLISHED',
  };
}

export const ENTRIES: readonly CatalogueEntry[] = [
  entry(T1, CAT_T1, SVC_T1_A, 'SVC_INT_A', BIND_T1_A, [JUR_REGION]),
  entry(T1, CAT_T1, SVC_T1_B, 'SVC_INT_B', BIND_T1_B, [JUR_ELSEWHERE]),
  entry(T2, CAT_T2, SVC_T2_A, 'SVC_INT_T2', BIND_T2_A, [JUR_REGION]),
];

export class StubCatalogue implements CataloguePort {
  versions: CatalogueVersionPin[] = [
    { tenant_id: T1, catalogue_version_id: CAT_T1, status: 'PUBLISHED' },
    { tenant_id: T1, catalogue_version_id: CAT_T1_DRAFT, status: 'DRAFT' },
    { tenant_id: T2, catalogue_version_id: CAT_T2, status: 'PUBLISHED' },
  ];
  async getVersion(input: { tenantId: string; catalogueVersionId: string }) {
    const v = this.versions.find(
      (x) => x.tenant_id === input.tenantId && x.catalogue_version_id === input.catalogueVersionId,
    );
    return v ? { ...v } : null;
  }
  async getEntries(input: { tenantId: string; catalogueVersionId: string; serviceIds: string[] }) {
    return ENTRIES.filter(
      (e) =>
        e.tenant_id === input.tenantId &&
        e.catalogue_version_id === input.catalogueVersionId &&
        input.serviceIds.includes(e.service_id),
    ).map((e) => structuredClone(e));
  }
}

export class StubJurisdictions implements JurisdictionPort {
  private readonly table: JurisdictionResolution[] = [
    { code: JUR_REGION, active: true, applicable_codes: [JUR_REGION] },
    { code: JUR_DISTRICT, active: true, applicable_codes: [JUR_DISTRICT, JUR_REGION] },
    { code: JUR_ELSEWHERE, active: true, applicable_codes: [JUR_ELSEWHERE] },
  ];
  async resolve(input: { tenantId: string; codes: string[] }) {
    return this.table.filter((r) => input.codes.includes(r.code)).map((r) => structuredClone(r));
  }
}

/** CMP-035-shaped projection read. `leak` injects a foreign-tenant hit to prove CMP-006 blocks it. */
export class StubSearch implements SearchPort {
  leak: SearchCandidate[] = [];
  async searchServices(input: Parameters<SearchPort['searchServices']>[0]) {
    const hits = ENTRIES.filter(
      (e) =>
        e.tenant_id === input.tenantId &&
        e.catalogue_version_id === input.catalogueVersionId &&
        e.jurisdiction_codes.some((j) => input.jurisdictionCodes.includes(j)),
    ).map((e) => ({ tenant_id: e.tenant_id, service_id: e.service_id }));
    return [...hits, ...this.leak].slice(input.offset, input.offset + input.limit);
  }
}

export interface DiscoveryTenantStore {
  queries: Record<string, DiscoveryQueryRecord>;
  results: DiscoveryResultRecord[];
  selections: DiscoverySelectionRecord[];
  idem: Map<string, IdemRow>;
  outbox: OutboxRow[];
}

export class InMemoryDiscoveryRepository implements DiscoveryRepository {
  readonly store = new TenantPartitionedStore<DiscoveryTenantStore>(() => ({
    queries: {},
    results: [],
    selections: [],
    idem: new Map(),
    outbox: [],
  }));

  inTransaction(): boolean {
    return this.store.inTransaction();
  }

  withTx<T>(ctx: RequestContext, fn: (tx: DiscoveryTx) => Promise<T>): Promise<T> {
    return this.store.run(ctx, (s) => {
      const tx: DiscoveryTx = {
        claimIdempotency: async (p) => claim(s.idem, p, () => new Cmp006Error('SF-APP-002')),
        completeIdempotency: async (p) => complete(s.idem, p),
        insertQuery: async (row) => {
          s.queries[row.query_id] = structuredClone(row);
        },
        insertResults: async (rows) => {
          s.results.push(...structuredClone(rows));
        },
        getQuery: async (id) => (s.queries[id] ? structuredClone(s.queries[id]) : undefined),
        getResults: async (id) =>
          s.results.filter((r) => r.query_id === id).sort((a, b) => a.rank - b.rank),
        insertSelection: async (row) => {
          if (
            s.selections.some((x) => x.query_id === row.query_id && x.service_id === row.service_id)
          ) {
            throw new Cmp006Error('SF-APP-002');
          }
          s.selections.push(structuredClone(row));
        },
        insertOutbox: async (envelope, topic) => {
          s.outbox.push({ topic, envelope: structuredClone(envelope) });
        },
      };
      return fn(tx);
    });
  }
}
