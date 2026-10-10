import type { Aggregation, DimensionSpec } from '../domain/projection.js';
import type { PeriodGranularity } from '../domain/period.js';
import type { DimensionValue } from '../domain/privacy.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface DefinitionRow {
  definition_id: string;
  metric_code: string;
  version_no: number;
  status: 'PUBLISHED' | 'RETIRED';
  publication_ref: string;
  purpose_code: string;
  source_event_type: string;
  source_aggregate_type: string | null;
  source_schema_version: number;
  aggregation: Aggregation;
  value_field: string | null;
  period_granularity: PeriodGranularity;
  dimensions: DimensionSpec[];
  min_cohort_size: number;
  created_at: string;
}

export interface ProjectionStateRow {
  definition_id: string;
  active_generation: number;
  building_generation: number | null;
  build_token: string | null;
  build_lease_expires_at: string | null;
  last_rebuilt_at: string | null;
}

export interface ContributionWrite {
  definition_id: string;
  generation: number;
  event_id: string;
  metric_code: string;
  purpose_code: string;
  period_start: string;
  period_end: string;
  dimensions: Record<string, DimensionValue>;
  dimension_hash: string;
  metric_id: string;
  delta: number;
  contributor_increment: number;
  occurred_at: string;
  now: Date;
}

export interface MetricPointRow {
  tenant_id: string;
  metric_id: string;
  definition_id: string;
  generation: number;
  metric_code: string;
  purpose_code: string;
  period_start: string;
  period_end: string;
  value: number;
  contributor_count: number;
  dimensions: Record<string, DimensionValue>;
  last_event_at: string;
  updated_at: string;
}

export interface MetricQuery {
  definition_ids: string[];
  period_from: string | null;
  period_to: string | null;
  dimensions: Record<string, string>;
  limit: number;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface AnalyticsTx {
  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'>;
  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;

  /** Handler-level duplicate-delivery guard (SF-CON-OUTBOX inbox). */
  claimInbox(consumerGroup: string, eventId: string): Promise<boolean>;

  insertDefinition(row: DefinitionRow & { created_by: string }): Promise<void>;
  getDefinition(id: string): Promise<DefinitionRow | null>;
  listDefinitions(metricCode: string | null): Promise<DefinitionRow[]>;
  listPublishedForEvent(eventType: string): Promise<DefinitionRow[]>;
  latestDefinitionVersion(metricCode: string): Promise<number>;
  retireDefinition(id: string, now: Date): Promise<void>;

  insertState(definitionId: string, now: Date): Promise<void>;
  /** `shared` takes a row lock so a concurrent generation swap cannot interleave with an apply. */
  getState(definitionId: string, opts?: { shared?: boolean }): Promise<ProjectionStateRow | null>;
  /**
   * Opens `active_generation + 1` for building under a lease. Refuses with SF-APP-001
   * REBUILD_IN_PROGRESS while another build holds an unexpired lease; an expired lease is taken over
   * and the abandoned partial generation is purged.
   */
  beginBuild(p: {
    definitionId: string;
    token: string;
    now: Date;
    leaseMs: number;
  }): Promise<number>;
  /** Extends the lease; refuses with REBUILD_SUPERSEDED when another build took over. */
  renewBuild(p: {
    definitionId: string;
    token: string;
    now: Date;
    leaseMs: number;
  }): Promise<number>;
  /** Atomically makes the building generation active and purges the superseded one. */
  activateBuild(p: { definitionId: string; token: string; now: Date }): Promise<number>;

  applyContribution(write: ContributionWrite): Promise<'applied' | 'duplicate'>;
  queryPoints(query: MetricQuery): Promise<MetricPointRow[]>;

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface AnalyticsRepository {
  withTx<T>(ctx: RequestContext, fn: (tx: AnalyticsTx) => Promise<T>): Promise<T>;
  inTransaction(): boolean;
}
