import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { DimensionSpec } from '../domain/projection.js';
import type { DimensionValue } from '../domain/privacy.js';
import { Cmp045Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  AnalyticsRepository,
  AnalyticsTx,
  ContributionWrite,
  DefinitionRow,
  MetricPointRow,
  MetricQuery,
  ProjectionStateRow,
  StoredIdempotent,
} from './types.js';

/** Minimal driver surface (node-postgres compatible); the host supplies the pool. */
export interface SqlResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<R>>;
  release(): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

const num = (v: unknown): number => Number(v);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

const DEFINITION_COLUMNS = `definition_id, metric_code, version_no, status, publication_ref, purpose_code,
  source_event_type, source_aggregate_type, source_schema_version, aggregation, value_field,
  period_granularity, dimensions, min_cohort_size, created_at`;

const SELECT_DEFINITION = `SELECT ${DEFINITION_COLUMNS} FROM sf_analytics.metric_definition`;
const SELECT_DEFINITION_BY_ID = `${SELECT_DEFINITION} WHERE tenant_id = $1 AND definition_id = $2`;
const SELECT_DEFINITIONS_BY_CODE = `${SELECT_DEFINITION}
  WHERE tenant_id = $1 AND ($2::text IS NULL OR metric_code = $2)
  ORDER BY metric_code, version_no`;
const SELECT_PUBLISHED_BY_EVENT = `${SELECT_DEFINITION}
  WHERE tenant_id = $1 AND source_event_type = $2 AND status = 'PUBLISHED'
  ORDER BY metric_code, version_no`;

function toDefinition(r: Record<string, unknown>): DefinitionRow {
  return {
    definition_id: String(r['definition_id']),
    metric_code: String(r['metric_code']),
    version_no: num(r['version_no']),
    status: r['status'] as DefinitionRow['status'],
    publication_ref: String(r['publication_ref']),
    purpose_code: String(r['purpose_code']),
    source_event_type: String(r['source_event_type']),
    source_aggregate_type: (r['source_aggregate_type'] as string | null) ?? null,
    source_schema_version: num(r['source_schema_version']),
    aggregation: r['aggregation'] as DefinitionRow['aggregation'],
    value_field: (r['value_field'] as string | null) ?? null,
    period_granularity: r['period_granularity'] as DefinitionRow['period_granularity'],
    dimensions: r['dimensions'] as DimensionSpec[],
    min_cohort_size: num(r['min_cohort_size']),
    created_at: iso(r['created_at']),
  };
}

function toState(r: Record<string, unknown>): ProjectionStateRow {
  return {
    definition_id: String(r['definition_id']),
    active_generation: num(r['active_generation']),
    building_generation:
      r['building_generation'] === null || r['building_generation'] === undefined
        ? null
        : num(r['building_generation']),
    build_token: (r['build_token'] as string | null) ?? null,
    build_lease_expires_at: isoOrNull(r['build_lease_expires_at']),
    last_rebuilt_at: isoOrNull(r['last_rebuilt_at']),
  };
}

function toPoint(r: Record<string, unknown>): MetricPointRow {
  return {
    tenant_id: String(r['tenant_id']),
    metric_id: String(r['metric_id']),
    definition_id: String(r['definition_id']),
    generation: num(r['generation']),
    metric_code: String(r['metric_code']),
    purpose_code: String(r['purpose_code']),
    period_start: iso(r['period_start']),
    period_end: iso(r['period_end']),
    value: num(r['value']),
    contributor_count: num(r['contributor_count']),
    dimensions: r['dimensions'] as Record<string, DimensionValue>,
    last_event_at: iso(r['last_event_at']),
    updated_at: iso(r['updated_at']),
  };
}

class PgTx implements AnalyticsTx {
  constructor(
    private readonly c: SqlClient,
    private readonly tenantId: string,
  ) {}

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'> {
    const expires = new Date(p.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.c.query(
      `INSERT INTO sf_analytics.idempotency_record (
         tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
       ON CONFLICT (tenant_id, principal_id, endpoint, idempotency_key) DO NOTHING`,
      [
        this.tenantId,
        p.principalId,
        p.endpoint,
        p.key,
        p.fingerprint,
        p.now.toISOString(),
        expires.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return 'claimed';
    const existing = await this.c.query<{
      request_fingerprint: string;
      status: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_analytics.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp045Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp045Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp045Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_analytics.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async claimInbox(consumerGroup: string, eventId: string): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_analytics.inbox_event (consumer_group, event_id, tenant_id)
       VALUES ($1, $2, $3) ON CONFLICT (consumer_group, event_id) DO NOTHING`,
      [consumerGroup, eventId, this.tenantId],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertDefinition(row: DefinitionRow & { created_by: string }): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_analytics.metric_definition (
         tenant_id, definition_id, metric_code, version_no, status, publication_ref, purpose_code,
         source_event_type, source_aggregate_type, source_schema_version, aggregation, value_field,
         period_granularity, dimensions, min_cohort_size, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
      [
        this.tenantId,
        row.definition_id,
        row.metric_code,
        row.version_no,
        row.status,
        row.publication_ref,
        row.purpose_code,
        row.source_event_type,
        row.source_aggregate_type,
        row.source_schema_version,
        row.aggregation,
        row.value_field,
        row.period_granularity,
        JSON.stringify(row.dimensions),
        row.min_cohort_size,
        row.created_by,
      ],
    );
  }

  async getDefinition(id: string): Promise<DefinitionRow | null> {
    const r = await this.c.query(SELECT_DEFINITION_BY_ID, [this.tenantId, id]);
    return r.rows[0] ? toDefinition(r.rows[0]) : null;
  }

  async listDefinitions(metricCode: string | null): Promise<DefinitionRow[]> {
    const r = await this.c.query(SELECT_DEFINITIONS_BY_CODE, [this.tenantId, metricCode]);
    return r.rows.map(toDefinition);
  }

  async listPublishedForEvent(eventType: string): Promise<DefinitionRow[]> {
    const r = await this.c.query(SELECT_PUBLISHED_BY_EVENT, [this.tenantId, eventType]);
    return r.rows.map(toDefinition);
  }

  async latestDefinitionVersion(metricCode: string): Promise<number> {
    const r = await this.c.query<{ v: string | number | null }>(
      `SELECT max(version_no) AS v FROM sf_analytics.metric_definition
        WHERE tenant_id = $1 AND metric_code = $2`,
      [this.tenantId, metricCode],
    );
    const v = r.rows[0]?.v;
    return v === null || v === undefined ? 0 : Number(v);
  }

  async retireDefinition(id: string, now: Date): Promise<void> {
    await this.c.query(
      `UPDATE sf_analytics.metric_definition
          SET status = 'RETIRED', retired_at = $3
        WHERE tenant_id = $1 AND definition_id = $2 AND status = 'PUBLISHED'`,
      [this.tenantId, id, now.toISOString()],
    );
  }

  async insertState(definitionId: string, now: Date): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_analytics.projection_state (tenant_id, definition_id, active_generation, created_at, updated_at)
       VALUES ($1, $2, 1, $3, $3)`,
      [this.tenantId, definitionId, now.toISOString()],
    );
  }

  async getState(
    definitionId: string,
    opts: { shared?: boolean } = {},
  ): Promise<ProjectionStateRow | null> {
    const select = `SELECT definition_id, active_generation, building_generation, build_token,
              build_lease_expires_at, last_rebuilt_at
         FROM sf_analytics.projection_state WHERE tenant_id = $1 AND definition_id = $2`;
    const r = await this.c.query(opts.shared ? `${select} FOR SHARE` : select, [
      this.tenantId,
      definitionId,
    ]);
    return r.rows[0] ? toState(r.rows[0]) : null;
  }

  async beginBuild(p: {
    definitionId: string;
    token: string;
    now: Date;
    leaseMs: number;
  }): Promise<number> {
    const locked = await this.c.query<{
      active_generation: number;
      building_generation: number | null;
      build_lease_expires_at: Date | string | null;
    }>(
      `SELECT active_generation, building_generation, build_lease_expires_at
         FROM sf_analytics.projection_state
        WHERE tenant_id = $1 AND definition_id = $2 FOR UPDATE`,
      [this.tenantId, p.definitionId],
    );
    const row = locked.rows[0];
    if (!row) throw new Cmp045Error('SF-SYS-002');
    if (
      row.building_generation !== null &&
      row.build_lease_expires_at !== null &&
      new Date(row.build_lease_expires_at).getTime() > p.now.getTime()
    ) {
      throw new Cmp045Error('SF-APP-001', { details: [{ code: 'REBUILD_IN_PROGRESS' }] });
    }
    const building = Number(row.active_generation) + 1;
    await this.purgeGeneration(p.definitionId, building);
    await this.c.query(
      `UPDATE sf_analytics.projection_state
          SET building_generation = $3, build_token = $4, build_lease_expires_at = $5, updated_at = $6
        WHERE tenant_id = $1 AND definition_id = $2`,
      [
        this.tenantId,
        p.definitionId,
        building,
        p.token,
        new Date(p.now.getTime() + p.leaseMs).toISOString(),
        p.now.toISOString(),
      ],
    );
    return building;
  }

  private async lockBuild(
    definitionId: string,
    token: string,
  ): Promise<{ active: number; building: number }> {
    const locked = await this.c.query<{
      active_generation: number;
      building_generation: number | null;
      build_token: string | null;
    }>(
      `SELECT active_generation, building_generation, build_token
         FROM sf_analytics.projection_state
        WHERE tenant_id = $1 AND definition_id = $2 FOR UPDATE`,
      [this.tenantId, definitionId],
    );
    const row = locked.rows[0];
    if (!row || row.building_generation === null || row.build_token !== token) {
      throw new Cmp045Error('SF-APP-001', { details: [{ code: 'REBUILD_SUPERSEDED' }] });
    }
    return { active: Number(row.active_generation), building: Number(row.building_generation) };
  }

  async renewBuild(p: {
    definitionId: string;
    token: string;
    now: Date;
    leaseMs: number;
  }): Promise<number> {
    const { building } = await this.lockBuild(p.definitionId, p.token);
    await this.c.query(
      `UPDATE sf_analytics.projection_state
          SET build_lease_expires_at = $3, updated_at = $4
        WHERE tenant_id = $1 AND definition_id = $2`,
      [
        this.tenantId,
        p.definitionId,
        new Date(p.now.getTime() + p.leaseMs).toISOString(),
        p.now.toISOString(),
      ],
    );
    return building;
  }

  async activateBuild(p: { definitionId: string; token: string; now: Date }): Promise<number> {
    const { active, building } = await this.lockBuild(p.definitionId, p.token);
    await this.c.query(
      `UPDATE sf_analytics.projection_state
          SET active_generation = $3, building_generation = NULL, build_token = NULL,
              build_lease_expires_at = NULL, last_rebuilt_at = $4, updated_at = $4
        WHERE tenant_id = $1 AND definition_id = $2`,
      [this.tenantId, p.definitionId, building, p.now.toISOString()],
    );
    await this.purgeGeneration(p.definitionId, active);
    return building;
  }

  private async purgeGeneration(definitionId: string, generation: number): Promise<void> {
    await this.c.query(
      `DELETE FROM sf_analytics.metric_point WHERE tenant_id = $1 AND definition_id = $2 AND generation = $3`,
      [this.tenantId, definitionId, generation],
    );
    await this.c.query(
      `DELETE FROM sf_analytics.projection_applied_event
        WHERE tenant_id = $1 AND definition_id = $2 AND generation = $3`,
      [this.tenantId, definitionId, generation],
    );
  }

  async applyContribution(w: ContributionWrite): Promise<'applied' | 'duplicate'> {
    const marked = await this.c.query(
      `INSERT INTO sf_analytics.projection_applied_event (tenant_id, definition_id, generation, event_id, applied_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [this.tenantId, w.definition_id, w.generation, w.event_id, w.now.toISOString()],
    );
    if ((marked.rowCount ?? 0) === 0) return 'duplicate';
    await this.c.query(
      `INSERT INTO sf_analytics.metric_point (
         tenant_id, definition_id, generation, period_start, dimension_hash, period_end, metric_id,
         metric_code, purpose_code, dimensions, value, contributor_count, last_event_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$14)
       ON CONFLICT (tenant_id, definition_id, generation, period_start, dimension_hash) DO UPDATE
          SET value = sf_analytics.metric_point.value + EXCLUDED.value,
              contributor_count = sf_analytics.metric_point.contributor_count + EXCLUDED.contributor_count,
              last_event_at = GREATEST(sf_analytics.metric_point.last_event_at, EXCLUDED.last_event_at),
              updated_at = EXCLUDED.updated_at`,
      [
        this.tenantId,
        w.definition_id,
        w.generation,
        w.period_start,
        w.dimension_hash,
        w.period_end,
        w.metric_id,
        w.metric_code,
        w.purpose_code,
        JSON.stringify(w.dimensions),
        w.delta,
        w.contributor_increment,
        w.occurred_at,
        w.now.toISOString(),
      ],
    );
    return 'applied';
  }

  async queryPoints(q: MetricQuery): Promise<MetricPointRow[]> {
    if (q.definition_ids.length === 0) return [];
    const r = await this.c.query(
      `SELECT p.tenant_id, p.metric_id, p.definition_id, p.generation, p.metric_code, p.purpose_code,
              p.period_start, p.period_end, p.value, p.contributor_count, p.dimensions,
              p.last_event_at, p.updated_at
         FROM sf_analytics.metric_point p
         JOIN sf_analytics.projection_state s
           ON s.tenant_id = p.tenant_id AND s.definition_id = p.definition_id
          AND s.active_generation = p.generation
        WHERE p.tenant_id = $1
          AND p.definition_id = ANY($2::uuid[])
          AND ($3::timestamptz IS NULL OR p.period_start >= $3)
          AND ($4::timestamptz IS NULL OR p.period_start < $4)
          AND p.dimensions @> $5::jsonb
        ORDER BY p.period_start, p.metric_code, p.dimension_hash
        LIMIT $6`,
      [
        this.tenantId,
        q.definition_ids,
        q.period_from,
        q.period_to,
        JSON.stringify(q.dimensions),
        q.limit,
      ],
    );
    return r.rows.map(toPoint);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_analytics.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        envelope.event_id,
        envelope.tenant_id,
        topic,
        topic === TOPIC_AUDIT
          ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
          : envelope.aggregate_id,
        envelope.event_type,
        envelope.schema_version,
        envelope.aggregate_type,
        envelope.aggregate_id,
        envelope.aggregate_version,
        JSON.stringify(envelope),
      ],
    );
  }
}

export class PgAnalyticsRepository implements AnalyticsRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: AnalyticsTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp045Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp045Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
    }
    const tenantId = ctx.tenant_id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const settings: [string, string][] = [
        ['app.tenant_id', tenantId],
        ['app.cell_id', ctx.cell_id],
        ['app.actor_type', ctx.actor.type],
        ['app.actor_id', ctx.actor.id],
        ['app.correlation_id', ctx.correlation_id],
      ];
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await this.als.run(true, () => fn(new PgTx(client, tenantId)));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection already failed; the original error is the one to surface
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
