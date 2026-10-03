import type { Pool, PoolClient, QueryResult } from 'pg';

export interface TenantRow {
  tenant_id: string;
  code: string;
  display_name: string;
  status: string;
  version: string;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

export interface BindingRow {
  binding_id: string;
  tenant_id: string;
  cell_id: string;
  isolation_model: string;
  valid_from: Date;
  seq: string;
  reason: string;
  requested_by: string;
}

export interface OrgRow {
  tenant_id: string;
  organisation_id: string;
  code: string;
  created_at: Date;
  created_by: string;
}

export interface OrgVersionRow {
  tenant_id: string;
  organisation_id: string;
  version_no: string;
  name: string;
  organisation_type_code: string;
  status: string;
  valid_from: Date;
  reason: string;
  created_by: string;
}

export interface OrgRelationRow {
  relation_id: string;
  tenant_id: string;
  child_organisation_id: string;
  parent_organisation_id: string | null;
  version_no: string;
  valid_from: Date;
}

export interface OfficeRow {
  tenant_id: string;
  office_id: string;
  organisation_id: string;
  code: string;
  name: string;
  status: string;
  version: string;
  created_at: Date;
  created_by: string;
  activated_at: Date | null;
}

export interface ProposalRow {
  proposal_id: string;
  tenant_id: string;
  proposed_cell_id: string;
  proposed_isolation_model: 'POOL' | 'BRIDGE' | 'SILO';
  status: string;
  reason: string;
  requested_by: string;
  valid_from: Date;
  approved_by: string | null;
  approved_at: Date | null;
}

export interface IdemRow {
  tenant_id: string | null;
  principal_id: string;
  endpoint: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
}

export interface MemoryStore {
  tenants: TenantRow[];
  bindings: BindingRow[];
  orgs: OrgRow[];
  orgVersions: OrgVersionRow[];
  orgRelations: OrgRelationRow[];
  offices: OfficeRow[];
  proposals: ProposalRow[];
  idemTenant: IdemRow[];
  idemPlatform: IdemRow[];
  outbox: unknown[];
  outboxPlatform: unknown[];
  setConfigs: { key: string; value: string }[];
  released: number;
  rollbackThrows: boolean;
  failQuery?: (sql: string) => unknown;
}

export function emptyStore(): MemoryStore {
  return {
    tenants: [],
    bindings: [],
    orgs: [],
    orgVersions: [],
    orgRelations: [],
    offices: [],
    proposals: [],
    idemTenant: [],
    idemPlatform: [],
    outbox: [],
    outboxPlatform: [],
    setConfigs: [],
    released: 0,
    rollbackThrows: false,
  };
}

function ok<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function latestRelation(
  store: MemoryStore,
  childId: string,
  asOf: Date,
): OrgRelationRow | undefined {
  return store.orgRelations
    .filter((r) => r.child_organisation_id === childId && r.valid_from.getTime() <= asOf.getTime())
    .sort(
      (a, b) =>
        b.valid_from.getTime() - a.valid_from.getTime() ||
        Number(b.version_no) - Number(a.version_no),
    )[0];
}

function latestVersion(store: MemoryStore, orgId: string, asOf: Date): OrgVersionRow | undefined {
  return store.orgVersions
    .filter((v) => v.organisation_id === orgId && v.valid_from.getTime() <= asOf.getTime())
    .sort(
      (a, b) =>
        b.valid_from.getTime() - a.valid_from.getTime() ||
        Number(b.version_no) - Number(a.version_no),
    )[0];
}

function dispatch(store: MemoryStore, sql: string, params: unknown[]): QueryResult {
  const injected = store.failQuery?.(sql);
  if (injected) throw injected;
  const s = compact(sql);
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT') return ok([]);
  if (upper === 'ROLLBACK') {
    if (store.rollbackThrows) throw new Error('rollback-failed');
    return ok([]);
  }
  if (s.includes('set_config')) {
    store.setConfigs.push({ key: String(params[0]), value: String(params[1]) });
    return ok([]);
  }
  if (upper.startsWith('SET LOCAL')) return ok([]);

  if (s.includes('WITH RECURSIVE walk')) {
    const start = String(params[0]);
    const asOf = asDate(params[1]);
    const maxDepth = Number(params[2]);
    const rows: { org_id: string; depth: number }[] = [{ org_id: start, depth: 1 }];
    let current = start;
    let depth = 1;
    while (depth < maxDepth) {
      const rel = latestRelation(store, current, asOf);
      if (!rel?.parent_organisation_id) break;
      depth += 1;
      rows.push({ org_id: rel.parent_organisation_id, depth });
      current = rel.parent_organisation_id;
    }
    return ok(rows);
  }

  if (s.includes('INSERT INTO sf_tenant_org.idempotency_record_platform')) {
    const principal_id = String(params[0]);
    const endpoint = String(params[1]);
    const idempotency_key = String(params[2]);
    const exists = store.idemPlatform.some(
      (r) =>
        r.principal_id === principal_id &&
        r.endpoint === endpoint &&
        r.idempotency_key === idempotency_key,
    );
    if (exists) return ok([], 0);
    store.idemPlatform.push({
      tenant_id: null,
      principal_id,
      endpoint,
      idempotency_key,
      request_fingerprint: String(params[3]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.idempotency_record (')) {
    const tenant_id = String(params[0]);
    const principal_id = String(params[1]);
    const endpoint = String(params[2]);
    const idempotency_key = String(params[3]);
    const exists = store.idemTenant.some(
      (r) =>
        r.tenant_id === tenant_id &&
        r.principal_id === principal_id &&
        r.endpoint === endpoint &&
        r.idempotency_key === idempotency_key,
    );
    if (exists) return ok([], 0);
    store.idemTenant.push({
      tenant_id,
      principal_id,
      endpoint,
      idempotency_key,
      request_fingerprint: String(params[4]),
      status: 'IN_PROGRESS',
      response_status: null,
      response_body: null,
    });
    return ok([], 1);
  }

  if (s.includes('FROM sf_tenant_org.idempotency_record_platform')) {
    const row = store.idemPlatform.find(
      (r) =>
        r.principal_id === String(params[0]) &&
        r.endpoint === String(params[1]) &&
        r.idempotency_key === String(params[2]),
    );
    return ok(row ? [row] : []);
  }

  if (s.includes('FROM sf_tenant_org.idempotency_record')) {
    const row = store.idemTenant.find(
      (r) =>
        r.tenant_id === String(params[0]) &&
        r.principal_id === String(params[1]) &&
        r.endpoint === String(params[2]) &&
        r.idempotency_key === String(params[3]),
    );
    return ok(row ? [row] : []);
  }

  if (s.includes('UPDATE sf_tenant_org.idempotency_record_platform')) {
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

  if (s.includes('UPDATE sf_tenant_org.idempotency_record')) {
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

  if (s.includes('INSERT INTO sf_tenant_org.outbox_event_platform')) {
    store.outboxPlatform.push(params);
    return ok([], 1);
  }
  if (s.includes('INSERT INTO sf_tenant_org.outbox_event (')) {
    store.outbox.push(params);
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.organisation_version')) {
    const created = s.includes("VALUES ($1,$2,1,$3,$4,'ACTIVE',$5,$6,$7,$5)");
    store.orgVersions.push({
      tenant_id: String(params[0]),
      organisation_id: String(params[1]),
      version_no: created ? '1' : String(params[2]),
      name: created ? String(params[2]) : String(params[3]),
      organisation_type_code: created ? String(params[3]) : String(params[4]),
      status: created ? 'ACTIVE' : String(params[5]),
      valid_from: asDate(created ? params[4] : params[6]),
      reason: created ? String(params[5]) : String(params[7]),
      created_by: created ? String(params[6]) : String(params[8]),
    });
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.organisation_relation')) {
    const create = s.includes("VALUES ($1,$2,$3,$4,'PARENT',1,$5,$6,$5)");
    store.orgRelations.push({
      relation_id: String(params[0]),
      tenant_id: String(params[1]),
      child_organisation_id: String(params[2]),
      parent_organisation_id: (params[3] as string | null) ?? null,
      version_no: create ? '1' : String(params[4]),
      valid_from: asDate(create ? params[4] : params[5]),
    });
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.organisation (')) {
    store.orgs.push({
      tenant_id: String(params[0]),
      organisation_id: String(params[1]),
      code: String(params[2]),
      created_at: asDate(params[3]),
      created_by: String(params[4]),
    });
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.office')) {
    store.offices.push({
      tenant_id: String(params[0]),
      office_id: String(params[1]),
      organisation_id: String(params[2]),
      code: String(params[3]),
      name: String(params[4]),
      status: 'DRAFT',
      version: '1',
      created_at: asDate(params[5]),
      created_by: String(params[6]),
      activated_at: null,
    });
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.tenant_cell_binding')) {
    const seq = params.length >= 8 ? String(params[5]) : '1';
    const validFrom = asDate(params[4]);
    store.bindings.push({
      binding_id: String(params[0]),
      tenant_id: String(params[1]),
      cell_id: String(params[2]),
      isolation_model: String(params[3]),
      valid_from: validFrom,
      seq,
      reason: String(params.length >= 8 ? params[6] : params[5]),
      requested_by: String(params.length >= 8 ? params[7] : params[6]),
    });
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.tenant_placement_proposal')) {
    store.proposals.push({
      proposal_id: String(params[0]),
      tenant_id: String(params[1]),
      proposed_cell_id: String(params[2]),
      proposed_isolation_model: params[3] as 'POOL' | 'BRIDGE' | 'SILO',
      status: 'PROPOSED',
      reason: String(params[4]),
      requested_by: String(params[5]),
      valid_from: asDate(params[6]),
      approved_by: null,
      approved_at: null,
    });
    return ok([], 1);
  }

  if (s.includes('INSERT INTO sf_tenant_org.tenant (')) {
    const code = String(params[1]);
    if (store.tenants.some((t) => t.code === code)) {
      throw Object.assign(new Error('unique'), { code: '23505' });
    }
    const now = asDate(params[3]);
    store.tenants.push({
      tenant_id: String(params[0]),
      code,
      display_name: String(params[2]),
      status: 'ACTIVE',
      version: '1',
      created_at: now,
      updated_at: now,
      created_by: String(params[4]),
    });
    return ok([], 1);
  }

  if (s.includes('UPDATE sf_tenant_org.office')) {
    const office = store.offices.find(
      (o) => o.office_id === String(params[1]) && o.status === 'DRAFT',
    );
    if (!office) return ok([], 0);
    office.status = 'ACTIVE';
    office.version = String(Number(office.version) + 1);
    office.activated_at = asDate(params[0]);
    return ok([{ version: office.version, activated_at: office.activated_at }], 1);
  }

  if (s.includes('UPDATE sf_tenant_org.tenant_placement_proposal')) {
    const proposal = store.proposals.find(
      (p) =>
        p.proposal_id === String(params[2]) &&
        p.tenant_id === String(params[3]) &&
        p.status === 'PROPOSED',
    );
    if (!proposal) return ok([], 0);
    proposal.status = 'APPROVED';
    proposal.approved_by = String(params[0]);
    proposal.approved_at = asDate(params[1]);
    return ok([
      {
        proposal_id: proposal.proposal_id,
        proposed_cell_id: proposal.proposed_cell_id,
        proposed_isolation_model: proposal.proposed_isolation_model,
        requested_by: proposal.requested_by,
        valid_from: proposal.valid_from,
      },
    ]);
  }

  if (s.includes('FROM sf_tenant_org.tenant') && s.includes('FOR UPDATE')) {
    const row = store.tenants.find((t) => t.tenant_id === String(params[0]));
    return ok(row ? [{ tenant_id: row.tenant_id }] : [], row ? 1 : 0);
  }

  if (s.includes('created_at, updated_at FROM sf_tenant_org.tenant')) {
    const row = store.tenants.find((t) => t.tenant_id === String(params[0]));
    return ok(row ? [row] : []);
  }

  if (s.includes('FROM sf_tenant_org.tenant_cell_binding')) {
    const tenantId = String(params[0]);
    const asOf = asDate(params[1]);
    const rows = store.bindings
      .filter((b) => b.tenant_id === tenantId && b.valid_from.getTime() <= asOf.getTime())
      .sort(
        (a, b) => b.valid_from.getTime() - a.valid_from.getTime() || Number(b.seq) - Number(a.seq),
      );
    const row = rows[0];
    return ok(row ? [row] : []);
  }

  if (
    s.includes('FROM sf_tenant_org.organisation_version') &&
    s.includes('ORDER BY version_no DESC')
  ) {
    const rows = store.orgVersions
      .filter((v) => v.organisation_id === String(params[0]))
      .sort((a, b) => Number(b.version_no) - Number(a.version_no));
    const row = rows[0];
    return ok(row ? [row] : []);
  }

  if (
    s.includes('FROM sf_tenant_org.organisation_relation') &&
    s.includes('ORDER BY version_no DESC')
  ) {
    const rows = store.orgRelations
      .filter((r) => r.child_organisation_id === String(params[0]))
      .sort((a, b) => Number(b.version_no) - Number(a.version_no));
    const row = rows[0];
    return ok(row ? [{ version_no: row.version_no }] : []);
  }

  if (s.includes('SELECT organisation_id FROM sf_tenant_org.organisation WHERE organisation_id')) {
    const row = store.orgs.find((o) => o.organisation_id === String(params[0]));
    return ok(row ? [{ organisation_id: row.organisation_id }] : [], row ? 1 : 0);
  }

  if (s.includes('FROM sf_tenant_org.organisation o')) {
    const asOf = asDate(params[0]);
    const parentId = (params[1] as string | null) ?? null;
    const after = (params[2] as string | null) ?? null;
    const limit = Number(params[3]);
    const items = store.orgs
      .slice()
      .sort((a, b) => a.organisation_id.localeCompare(b.organisation_id))
      .filter((o) => !after || o.organisation_id > after)
      .map((o) => {
        const v = latestVersion(store, o.organisation_id, asOf);
        const r = latestRelation(store, o.organisation_id, asOf);
        return {
          organisation_id: o.organisation_id,
          code: o.code,
          name: v?.name ?? o.code,
          organisation_type_code: v?.organisation_type_code ?? 'DEPT',
          status: v?.status ?? 'ACTIVE',
          version_no: v?.version_no ?? '1',
          valid_from: v?.valid_from ?? o.created_at,
          parent_organisation_id: r?.parent_organisation_id ?? null,
        };
      })
      .filter((row) => parentId === null || row.parent_organisation_id === parentId)
      .slice(0, limit);
    return ok(items);
  }

  if (s.includes('FROM sf_tenant_org.office') && s.includes('OR organisation_id')) {
    const orgId = (params[0] as string | null) ?? null;
    const status = (params[1] as string | null) ?? null;
    const limit = Number(params[2]);
    const rows = store.offices
      .filter(
        (o) =>
          (orgId === null || o.organisation_id === orgId) &&
          (status === null || o.status === status),
      )
      .sort((a, b) => a.office_id.localeCompare(b.office_id))
      .slice(0, limit);
    return ok(rows);
  }

  if (s.includes('FROM sf_tenant_org.office WHERE office_id')) {
    const row = store.offices.find((o) => o.office_id === String(params[0]));
    return ok(row ? [row] : []);
  }

  throw new Error(`unhandled sql: ${s.slice(0, 180)}`);
}

export function createMemoryPool(store: MemoryStore): Pool {
  const connect = async (): Promise<PoolClient> => {
    const client = {
      query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
      release: () => {
        store.released += 1;
      },
    };
    return client as unknown as PoolClient;
  };
  return {
    connect,
    query: async (sql: string, params?: unknown[]) => dispatch(store, sql, params ?? []),
  } as unknown as Pool;
}

export function seedTenant(
  store: MemoryStore,
  params: { tenantId: string; code: string; actorId: string; binding?: boolean; cellId?: string },
): void {
  const now = new Date('2026-01-01T00:00:00.000Z');
  store.tenants.push({
    tenant_id: params.tenantId,
    code: params.code,
    display_name: params.code,
    status: 'ACTIVE',
    version: '1',
    created_at: now,
    updated_at: now,
    created_by: params.actorId,
  });
  if (params.binding !== false) {
    store.bindings.push({
      binding_id: 'b1111111-1111-4111-8111-111111111111',
      tenant_id: params.tenantId,
      cell_id: params.cellId ?? 'cell-01',
      isolation_model: 'POOL',
      valid_from: now,
      seq: '1',
      reason: 'seed',
      requested_by: params.actorId,
    });
  }
}
