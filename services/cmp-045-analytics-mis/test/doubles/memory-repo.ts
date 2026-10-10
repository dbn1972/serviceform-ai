import { Cmp045Error } from '../../src/errors.js';
import type {
  AnalyticsRepository,
  AnalyticsTx,
  ContributionWrite,
  DefinitionRow,
  MetricPointRow,
  MetricQuery,
  ProjectionStateRow,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

interface StateRec extends ProjectionStateRow {
  build_lease_ms_expires: number | null;
}

interface TenantData {
  definitions: Map<string, DefinitionRow>;
  states: Map<string, StateRec>;
  points: Map<string, MetricPointRow>;
  applied: Set<string>;
  inbox: Set<string>;
  idempotency: Map<string, { fingerprint: string; response?: StoredIdempotent }>;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

const emptyTenant = (): TenantData => ({
  definitions: new Map(),
  states: new Map(),
  points: new Map(),
  applied: new Set(),
  inbox: new Set(),
  idempotency: new Map(),
  outbox: [],
});

const pointKey = (definitionId: string, generation: number, periodStart: string, hash: string) =>
  `${definitionId}|${generation}|${periodStart}|${hash}`;

/**
 * Tenant-keyed in-memory repository. Every operation is scoped to the transaction's tenant, the
 * unit-level analogue of FORCE RLS; the real boundary is proven in test/integration.
 */
export class MemoryAnalyticsRepository implements AnalyticsRepository {
  private tenants = new Map<string, TenantData>();
  private active = false;
  /** Test hook to fail the n-th transaction commit, proving rollback leaves no partial state. */
  failNextCommit = false;

  inTransaction(): boolean {
    return this.active;
  }

  tenant(tenantId: string): TenantData {
    let t = this.tenants.get(tenantId);
    if (!t) {
      t = emptyTenant();
      this.tenants.set(tenantId, t);
    }
    return t;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: AnalyticsTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp045Error('SF-TEN-001');
    if (this.active) throw new Cmp045Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
    const snapshot = structuredClone(this.tenants);
    this.active = true;
    try {
      const out = await fn(new MemoryTx(this.tenant(ctx.tenant_id), ctx.tenant_id));
      if (this.failNextCommit) {
        this.failNextCommit = false;
        throw new Error('commit failed');
      }
      return out;
    } catch (err) {
      this.tenants = snapshot;
      throw err;
    } finally {
      this.active = false;
    }
  }
}

class MemoryTx implements AnalyticsTx {
  constructor(
    private readonly d: TenantData,
    private readonly tenantId: string,
  ) {}

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'> {
    const k = `${p.principalId}|${p.endpoint}|${p.key}`;
    const existing = this.d.idempotency.get(k);
    if (!existing) {
      this.d.idempotency.set(k, { fingerprint: p.fingerprint });
      return Promise.resolve('claimed');
    }
    if (existing.fingerprint !== p.fingerprint) throw new Cmp045Error('SF-APP-002');
    if (existing.response) return Promise.resolve(existing.response);
    throw new Cmp045Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const rec = this.d.idempotency.get(`${p.principalId}|${p.endpoint}|${p.key}`);
    if (rec) rec.response = { status: p.status, body: structuredClone(p.body) };
    return Promise.resolve();
  }

  claimInbox(group: string, eventId: string): Promise<boolean> {
    const k = `${group}|${eventId}`;
    if (this.d.inbox.has(k)) return Promise.resolve(false);
    this.d.inbox.add(k);
    return Promise.resolve(true);
  }

  insertDefinition(row: DefinitionRow & { created_by: string }): Promise<void> {
    const { created_by: _by, ...rest } = row;
    this.d.definitions.set(row.definition_id, rest);
    return Promise.resolve();
  }
  getDefinition(id: string): Promise<DefinitionRow | null> {
    return Promise.resolve(this.d.definitions.get(id) ?? null);
  }
  listDefinitions(code: string | null): Promise<DefinitionRow[]> {
    return Promise.resolve(
      [...this.d.definitions.values()]
        .filter((r) => code === null || r.metric_code === code)
        .sort((a, b) => a.metric_code.localeCompare(b.metric_code) || a.version_no - b.version_no),
    );
  }
  listPublishedForEvent(eventType: string): Promise<DefinitionRow[]> {
    return Promise.resolve(
      [...this.d.definitions.values()].filter(
        (r) => r.source_event_type === eventType && r.status === 'PUBLISHED',
      ),
    );
  }
  latestDefinitionVersion(code: string): Promise<number> {
    return Promise.resolve(
      Math.max(
        0,
        ...[...this.d.definitions.values()]
          .filter((r) => r.metric_code === code)
          .map((r) => r.version_no),
      ),
    );
  }
  retireDefinition(id: string): Promise<void> {
    const row = this.d.definitions.get(id);
    if (row) row.status = 'RETIRED';
    return Promise.resolve();
  }

  insertState(definitionId: string): Promise<void> {
    this.d.states.set(definitionId, {
      definition_id: definitionId,
      active_generation: 1,
      building_generation: null,
      build_token: null,
      build_lease_expires_at: null,
      build_lease_ms_expires: null,
      last_rebuilt_at: null,
    });
    return Promise.resolve();
  }
  getState(definitionId: string): Promise<ProjectionStateRow | null> {
    const s = this.d.states.get(definitionId);
    return Promise.resolve(s ? { ...s } : null);
  }

  private purge(definitionId: string, generation: number): void {
    for (const [k, p] of this.d.points) {
      if (p.definition_id === definitionId && p.generation === generation) this.d.points.delete(k);
    }
    for (const k of [...this.d.applied]) {
      if (k.startsWith(`${definitionId}|${generation}|`)) this.d.applied.delete(k);
    }
  }

  beginBuild(p: {
    definitionId: string;
    token: string;
    now: Date;
    leaseMs: number;
  }): Promise<number> {
    const s = this.d.states.get(p.definitionId);
    if (!s) throw new Cmp045Error('SF-SYS-002');
    if (
      s.building_generation !== null &&
      s.build_lease_ms_expires !== null &&
      s.build_lease_ms_expires > p.now.getTime()
    ) {
      throw new Cmp045Error('SF-APP-001', { details: [{ code: 'REBUILD_IN_PROGRESS' }] });
    }
    const building = s.active_generation + 1;
    this.purge(p.definitionId, building);
    s.building_generation = building;
    s.build_token = p.token;
    s.build_lease_ms_expires = p.now.getTime() + p.leaseMs;
    return Promise.resolve(building);
  }
  renewBuild(p: {
    definitionId: string;
    token: string;
    now: Date;
    leaseMs: number;
  }): Promise<number> {
    const s = this.d.states.get(p.definitionId);
    if (!s || s.building_generation === null || s.build_token !== p.token) {
      throw new Cmp045Error('SF-APP-001', { details: [{ code: 'REBUILD_SUPERSEDED' }] });
    }
    s.build_lease_ms_expires = p.now.getTime() + p.leaseMs;
    return Promise.resolve(s.building_generation);
  }
  activateBuild(p: { definitionId: string; token: string; now: Date }): Promise<number> {
    const s = this.d.states.get(p.definitionId);
    if (!s || s.building_generation === null || s.build_token !== p.token) {
      throw new Cmp045Error('SF-APP-001', { details: [{ code: 'REBUILD_SUPERSEDED' }] });
    }
    const previous = s.active_generation;
    s.active_generation = s.building_generation;
    s.building_generation = null;
    s.build_token = null;
    s.build_lease_ms_expires = null;
    s.last_rebuilt_at = p.now.toISOString();
    this.purge(p.definitionId, previous);
    return Promise.resolve(s.active_generation);
  }

  applyContribution(w: ContributionWrite): Promise<'applied' | 'duplicate'> {
    const appliedKey = `${w.definition_id}|${w.generation}|${w.event_id}`;
    if (this.d.applied.has(appliedKey)) return Promise.resolve('duplicate');
    this.d.applied.add(appliedKey);
    const key = pointKey(w.definition_id, w.generation, w.period_start, w.dimension_hash);
    const existing = this.d.points.get(key);
    if (existing) {
      existing.value += w.delta;
      existing.contributor_count += w.contributor_increment;
      if (w.occurred_at > existing.last_event_at) existing.last_event_at = w.occurred_at;
      existing.updated_at = w.now.toISOString();
    } else {
      this.d.points.set(key, {
        tenant_id: this.tenantId,
        metric_id: w.metric_id,
        definition_id: w.definition_id,
        generation: w.generation,
        metric_code: w.metric_code,
        purpose_code: w.purpose_code,
        period_start: w.period_start,
        period_end: w.period_end,
        value: w.delta,
        contributor_count: w.contributor_increment,
        dimensions: { ...w.dimensions },
        last_event_at: w.occurred_at,
        updated_at: w.now.toISOString(),
      });
    }
    return Promise.resolve('applied');
  }

  queryPoints(q: MetricQuery): Promise<MetricPointRow[]> {
    const rows = [...this.d.points.values()]
      .filter((p) => q.definition_ids.includes(p.definition_id))
      .filter((p) => this.d.states.get(p.definition_id)?.active_generation === p.generation)
      .filter((p) => q.period_from === null || p.period_start >= q.period_from)
      .filter((p) => q.period_to === null || p.period_start < q.period_to)
      .filter((p) => Object.entries(q.dimensions).every(([k, v]) => p.dimensions[k] === v))
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
      .slice(0, q.limit);
    return Promise.resolve(rows);
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.d.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
