import type { Pool, PoolClient, QueryResult } from 'pg';

export interface MemoryStore {
  categories: {
    category_id: string;
    category_code: string;
    display_label: string;
    parent_category_id: string | null;
    status: string;
  }[];
  canonical: {
    canonical_service_id: string;
    service_code: string;
    category_id: string;
    status: string;
  }[];
  canonicalVersions: {
    canonical_service_id: string;
    version_no: number;
    title: string;
    summary: string;
    tags: string[];
    status: string;
  }[];
  offerings: {
    tenant_id: string;
    offering_id: string;
    canonical_service_id: string;
    offering_code: string;
  }[];
  offeringVersions: {
    tenant_id: string;
    offering_id: string;
    version_no: number;
    local_name: string;
    status: string;
    tags: string[];
    published_pin_ref: string | null;
    provider_org_ref: string | null;
    provider_office_ref: string | null;
  }[];
  bindings: {
    binding_id: string;
    tenant_id: string;
    offering_id: string;
    version_no: number;
    jurisdiction_ref: string;
    target_type: string;
    target_ref: string;
  }[];
  idemTenant: {
    tenant_id: string;
    principal_id: string;
    endpoint: string;
    idempotency_key: string;
    request_fingerprint: string;
    status: string;
    response_status: number | null;
    response_body: unknown;
  }[];
  idemPlatform: {
    principal_id: string;
    endpoint: string;
    idempotency_key: string;
    request_fingerprint: string;
    status: string;
    response_status: number | null;
    response_body: unknown;
  }[];
  outbox: unknown[];
  outboxPlatform: unknown[];
  tenantId: string | null;
}

export function emptyStore(): MemoryStore {
  return {
    categories: [],
    canonical: [],
    canonicalVersions: [],
    offerings: [],
    offeringVersions: [],
    bindings: [],
    idemTenant: [],
    idemPlatform: [],
    outbox: [],
    outboxPlatform: [],
    tenantId: null,
  };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function dispatch(store: MemoryStore, sql: string, params: unknown[]): QueryResult {
  const s = compact(sql);
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') return ok([]);
  if (s.includes('set_config')) {
    if (String(params[0]) === 'app.tenant_id') store.tenantId = String(params[1]);
    return ok([]);
  }

  if (s.includes('INSERT INTO sf_catalogue.idempotency_record_platform')) {
    const exists = store.idemPlatform.some(
      (r) =>
        r.principal_id === String(params[0]) &&
        r.endpoint === String(params[1]) &&
        r.idempotency_key === String(params[2]),
    );
    if (exists) return ok([], 0);
    store.idemPlatform.push({
      principal_id: String(params[0]),
      endpoint: String(params[1]),
      idempotency_key: String(params[2]),
      request_fingerprint: String(params[3]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_catalogue.idempotency_record (')) {
    const exists = store.idemTenant.some(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    if (exists) return ok([], 0);
    store.idemTenant.push({
      tenant_id: String(params[0]),
      principal_id: String(params[1]),
      endpoint: String(params[2]),
      idempotency_key: String(params[3]),
      request_fingerprint: String(params[4]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return ok([], 1);
  }
  if (s.includes('FROM sf_catalogue.idempotency_record_platform')) {
    const row = store.idemPlatform.find(
      (r) =>
        r.principal_id === String(params[0]) &&
        r.endpoint === String(params[1]) &&
        r.idempotency_key === String(params[2]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('FROM sf_catalogue.idempotency_record')) {
    const row = store.idemTenant.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }
  if (s.includes('UPDATE sf_catalogue.idempotency_record_platform')) {
    const row = store.idemPlatform.find(
      (r) =>
        r.principal_id === String(params[3]) &&
        r.endpoint === String(params[4]) &&
        r.idempotency_key === String(params[5]),
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(params[1]);
      row.response_body = JSON.parse(String(params[2]));
    }
    return ok([], row ? 1 : 0);
  }
  if (s.includes('UPDATE sf_catalogue.idempotency_record')) {
    const row = store.idemTenant.find(
      (r) =>
        r.tenant_id === String(params[3]) &&
        r.principal_id === String(params[4]) &&
        r.endpoint === String(params[5]) &&
        r.idempotency_key === String(params[6]),
    );
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = Number(params[1]);
      row.response_body = JSON.parse(String(params[2]));
    }
    return ok([], row ? 1 : 0);
  }
  if (s.includes('INSERT INTO sf_catalogue.outbox_event_platform')) {
    store.outboxPlatform.push(params);
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_catalogue.outbox_event (')) {
    store.outbox.push(params);
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_catalogue.category')) {
    store.categories.push({
      category_id: String(params[0]),
      category_code: String(params[1]),
      display_label: String(params[2]),
      parent_category_id: (params[3] as string | null) ?? null,
      status: 'ACTIVE',
    });
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_catalogue.canonical_service (')) {
    store.canonical.push({
      canonical_service_id: String(params[0]),
      service_code: String(params[1]),
      category_id: String(params[2]),
      status: 'DRAFT',
    });
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_catalogue.canonical_service_version')) {
    store.canonicalVersions.push({
      canonical_service_id: String(params[0]),
      version_no: Number(params[1]),
      title: String(params[2]),
      summary: String(params[3]),
      tags: (params[4] as string[]) ?? [],
      status: String(params[5]),
    });
    return ok([], 1);
  }
  if (s.includes('UPDATE sf_catalogue.canonical_service SET status')) {
    const row = store.canonical.find((c) => c.canonical_service_id === String(params[1]));
    if (row) row.status = String(params[0]);
    return ok([], row ? 1 : 0);
  }
  if (s.includes('INSERT INTO sf_catalogue.offering (')) {
    store.offerings.push({
      tenant_id: String(params[0]),
      offering_id: String(params[1]),
      canonical_service_id: String(params[2]),
      offering_code: String(params[3]),
    });
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_catalogue.offering_version')) {
    const create = s.includes("VALUES ($1,$2,1,$3,'DRAFT'");
    store.offeringVersions.push({
      tenant_id: String(params[0]),
      offering_id: String(params[1]),
      version_no: create ? 1 : Number(params[2]),
      local_name: create ? String(params[2]) : String(params[3]),
      status: create ? 'DRAFT' : String(params[4]),
      provider_org_ref: create
        ? ((params[3] as string | null) ?? null)
        : ((params[5] as string | null) ?? null),
      provider_office_ref: create
        ? ((params[4] as string | null) ?? null)
        : ((params[6] as string | null) ?? null),
      tags: create ? ((params[5] as string[]) ?? []) : ((params[7] as string[]) ?? []),
      published_pin_ref: null,
    });
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_catalogue.offering_binding')) {
    store.bindings.push({
      binding_id: String(params[0]),
      tenant_id: String(params[1]),
      offering_id: String(params[2]),
      version_no: Number(params[3]),
      jurisdiction_ref: String(params[4]),
      target_type: String(params[5]),
      target_ref: String(params[6]),
    });
    return ok([], 1);
  }
  if (s.includes('FROM sf_catalogue.category') && s.includes("status = 'ACTIVE'")) {
    return ok(store.categories.filter((c) => c.status === 'ACTIVE'));
  }
  if (s.includes('FROM sf_catalogue.canonical_service s') && s.includes('WHERE s.status')) {
    return ok(
      store.canonical
        .filter((c) => c.status !== 'RETIRED')
        .map((c) => {
          const v = store.canonicalVersions
            .filter((x) => x.canonical_service_id === c.canonical_service_id)
            .sort((a, b) => b.version_no - a.version_no)[0];
          return {
            ...c,
            version_no: v?.version_no ?? 1,
            title: v?.title ?? '',
            summary: v?.summary ?? '',
            tags: v?.tags ?? [],
          };
        }),
    );
  }
  if (
    s.includes('FROM sf_catalogue.canonical_service s') &&
    s.includes('WHERE s.canonical_service_id')
  ) {
    const c = store.canonical.find((x) => x.canonical_service_id === String(params[0]));
    if (!c) return ok([]);
    const v = store.canonicalVersions
      .filter((x) => x.canonical_service_id === c.canonical_service_id)
      .sort((a, b) => b.version_no - a.version_no)[0];
    return ok([
      {
        ...c,
        version_no: v?.version_no ?? 1,
        title: v?.title ?? '',
        summary: v?.summary ?? '',
        tags: v?.tags ?? [],
      },
    ]);
  }
  if (
    s.includes('FROM sf_catalogue.canonical_service_version') &&
    s.includes('ORDER BY version_no DESC')
  ) {
    const rows = store.canonicalVersions
      .filter((v) => v.canonical_service_id === String(params[0]))
      .sort((a, b) => b.version_no - a.version_no);
    return ok(rows[0] ? [{ version_no: String(rows[0].version_no) }] : []);
  }
  if (
    s.includes('FROM sf_catalogue.offering_version') &&
    s.includes('ORDER BY version_no DESC') &&
    s.includes('published_pin_ref') &&
    !s.includes('JOIN LATERAL')
  ) {
    const rows = store.offeringVersions
      .filter((v) => v.offering_id === String(params[0]))
      .sort((a, b) => b.version_no - a.version_no);
    const row = rows[0];
    return ok(
      row
        ? [
            {
              version_no: String(row.version_no),
              published_pin_ref: row.published_pin_ref,
              status: row.status,
            },
          ]
        : [],
    );
  }
  if (s.includes('FROM sf_catalogue.offering o') && s.includes('WHERE o.offering_id = $1')) {
    const o = store.offerings.find((x) => x.offering_id === String(params[0]));
    if (!o) return ok([]);
    const v = store.offeringVersions
      .filter((x) => x.offering_id === o.offering_id)
      .sort((a, b) => b.version_no - a.version_no)[0];
    return ok([
      {
        offering_id: o.offering_id,
        offering_code: o.offering_code,
        canonical_service_id: o.canonical_service_id,
        version_no: v?.version_no ?? 1,
        local_name: v?.local_name ?? '',
        status: v?.status ?? 'DRAFT',
        tags: v?.tags ?? [],
        published_pin_ref: v?.published_pin_ref ?? null,
        provider_org_ref: v?.provider_org_ref ?? null,
        provider_office_ref: v?.provider_office_ref ?? null,
      },
    ]);
  }
  if (s.includes('FROM sf_catalogue.offering o') && s.includes('JOIN LATERAL')) {
    const after = (params[0] as string | null) ?? null;
    const status = (params[1] as string | null) ?? null;
    const tag = (params[2] as string | null) ?? null;
    const categoryId = (params[3] as string | null) ?? null;
    const limit = Number(params[4]);
    const items = store.offerings
      .filter((o) => !after || o.offering_id > after)
      .map((o) => {
        const v = store.offeringVersions
          .filter((x) => x.offering_id === o.offering_id)
          .sort((a, b) => b.version_no - a.version_no)[0];
        const canon = store.canonical.find(
          (c) => c.canonical_service_id === o.canonical_service_id,
        );
        return {
          offering_id: o.offering_id,
          offering_code: o.offering_code,
          canonical_service_id: o.canonical_service_id,
          version_no: v?.version_no ?? 1,
          local_name: v?.local_name ?? '',
          status: v?.status ?? 'DRAFT',
          tags: v?.tags ?? [],
          published_pin_ref: v?.published_pin_ref ?? null,
          category_id: canon?.category_id,
        };
      })
      .filter((row) => !status || row.status === status)
      .filter((row) => !tag || row.tags.includes(tag))
      .filter((row) => !categoryId || row.category_id === categoryId)
      .slice(0, limit);
    return ok(items);
  }

  throw new Error(`unhandled sql: ${s.slice(0, 220)}`);
}

export function createMemoryPool(store: MemoryStore): Pool {
  const connect = async (): Promise<PoolClient> => {
    const client = {
      query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
      release: () => undefined,
    };
    return client as unknown as PoolClient;
  };
  return {
    connect,
    query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
  } as unknown as Pool;
}
