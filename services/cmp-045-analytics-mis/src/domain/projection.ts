import { canonicalJson, sha256Prefixed } from './fingerprint.js';
import { periodFor, type PeriodGranularity } from './period.js';
import { safeDimensionValue, type DimensionValue } from './privacy.js';

export type Aggregation = 'COUNT' | 'SUM';

export interface DimensionSpec {
  key: string;
  source_field: string;
  allowed_values?: string[];
}

export interface ProjectionSpec {
  source_event_type: string;
  source_aggregate_type: string | null;
  source_schema_version: number;
  aggregation: Aggregation;
  value_field: string | null;
  period_granularity: PeriodGranularity;
  dimensions: DimensionSpec[];
}

export interface EventLike {
  event_type: string;
  schema_version: number;
  aggregate_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

export interface Contribution {
  period_start: string;
  period_end: string;
  dimensions: Record<string, DimensionValue>;
  dimension_hash: string;
  delta: number;
  unclassified_dimensions: number;
}

export class ProjectionError extends Error {
  constructor(readonly code: 'SCHEMA_VERSION_UNSUPPORTED' | 'VALUE_FIELD_INVALID') {
    super(code);
    this.name = 'ProjectionError';
  }
}

const MAX_ABS_VALUE = 1e12;

export function matchesDefinition(spec: ProjectionSpec, event: EventLike): boolean {
  if (spec.source_event_type !== event.event_type) return false;
  return spec.source_aggregate_type === null || spec.source_aggregate_type === event.aggregate_type;
}

export function dimensionHashOf(dimensions: Record<string, DimensionValue>): string {
  return sha256Prefixed(canonicalJson(dimensions));
}

/**
 * Pure derivation of one aggregate contribution from one event. Only allowlisted top-level data
 * fields are read; nothing from the event is retained except the aggregated delta, so no raw
 * payload can reach the analytics store.
 */
export function contributionOf(spec: ProjectionSpec, event: EventLike): Contribution {
  if (event.schema_version !== spec.source_schema_version) {
    throw new ProjectionError('SCHEMA_VERSION_UNSUPPORTED');
  }
  let delta = 1;
  if (spec.aggregation === 'SUM') {
    const raw = spec.value_field === null ? undefined : event.data[spec.value_field];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > MAX_ABS_VALUE) {
      throw new ProjectionError('VALUE_FIELD_INVALID');
    }
    delta = raw;
  }
  const dimensions: Record<string, DimensionValue> = {};
  let unclassified = 0;
  for (const dim of [...spec.dimensions].sort((a, b) => a.key.localeCompare(b.key))) {
    const picked = safeDimensionValue(event.data[dim.source_field], dim.allowed_values);
    dimensions[dim.key] = picked.value;
    if (picked.unclassified) unclassified += 1;
  }
  const period = periodFor(event.occurred_at, spec.period_granularity);
  return {
    period_start: period.start,
    period_end: period.end,
    dimensions,
    dimension_hash: dimensionHashOf(dimensions),
    delta,
    unclassified_dimensions: unclassified,
  };
}
