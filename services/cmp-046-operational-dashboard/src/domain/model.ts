import { createHash } from 'node:crypto';
import { isUuid } from './uuid.js';

/**
 * CMP-046 owns derived, NON-AUTHORITATIVE operational read models only. Every view is a
 * tenant-scoped aggregate snapshot of facts owned by another component and read through a port.
 */
export const VIEW_CODES = [
  'SLA_SUMMARY',
  'QUEUE_SUMMARY',
  'INTEGRATION_HEALTH',
  'EVENT_HEALTH',
  'PLATFORM_HEALTH',
] as const;
export type ViewCode = (typeof VIEW_CODES)[number];

export const SOURCE_COMPONENTS = ['CMP-017', 'CMP-029', 'CMP-037', 'CMP-038', 'CMP-047'] as const;
export type SourceComponent = (typeof SOURCE_COMPONENTS)[number];

export interface ViewDefinition {
  code: ViewCode;
  readAction: string;
  sourceComponent: SourceComponent;
  maxAgeSeconds: number;
}

export const VIEW_DEFINITIONS: Readonly<Record<ViewCode, ViewDefinition>> = {
  SLA_SUMMARY: {
    code: 'SLA_SUMMARY',
    readAction: 'OPS_VIEW_SLA',
    sourceComponent: 'CMP-029',
    maxAgeSeconds: 300,
  },
  QUEUE_SUMMARY: {
    code: 'QUEUE_SUMMARY',
    readAction: 'OPS_VIEW_QUEUE',
    sourceComponent: 'CMP-017',
    maxAgeSeconds: 300,
  },
  INTEGRATION_HEALTH: {
    code: 'INTEGRATION_HEALTH',
    readAction: 'OPS_VIEW_INTEGRATION',
    sourceComponent: 'CMP-037',
    maxAgeSeconds: 120,
  },
  EVENT_HEALTH: {
    code: 'EVENT_HEALTH',
    readAction: 'OPS_VIEW_EVENTS',
    sourceComponent: 'CMP-038',
    maxAgeSeconds: 120,
  },
  PLATFORM_HEALTH: {
    code: 'PLATFORM_HEALTH',
    readAction: 'OPS_VIEW_HEALTH',
    sourceComponent: 'CMP-047',
    maxAgeSeconds: 120,
  },
};

export const REFRESH_ACTION = 'OPS_REFRESH_VIEW';
export const OPS_RESOURCE_TYPE = 'OpsDashboardView';

export type ViewStatus = 'OK' | 'DEGRADED' | 'UNAVAILABLE';
export const VIEW_STATUSES: readonly ViewStatus[] = ['OK', 'DEGRADED', 'UNAVAILABLE'];
export type RefreshOutcome = 'SUCCESS' | 'SOURCE_FAILED' | 'PAYLOAD_INVALID';

export type DimensionValue = string | number | boolean;
export interface OpsMetric {
  metric_code: string;
  value: number;
  dimensions?: Record<string, DimensionValue>;
}

export interface PortSample {
  status: ViewStatus;
  metrics: OpsMetric[];
  source_observed_at?: string;
}

export function isViewCode(value: string): value is ViewCode {
  return (VIEW_CODES as readonly string[]).includes(value);
}

const METRIC_CODE = /^[A-Z][A-Z0-9_.-]{1,63}$/;
const DIMENSION_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const DIMENSION_CODE_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** Aggregates only: dimension names that denote a person or an individual record are refused. */
const PERSONAL_DIMENSION =
  /(^|_)(application|applicant|citizen|case|user|actor|person|name|email|phone|mobile|aadhaar|pan|dob|address|token|secret)(_|$)/;
export const MAX_METRICS = 200;
export const MAX_DIMENSIONS = 8;

export class SampleRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SampleRejected';
  }
}

function reject(reason: string): never {
  throw new SampleRejected(reason);
}

/** Validates a port sample so a dashboard row can never carry an individual record or free text. */
export function normalizeSample(raw: unknown): PortSample {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) reject('SAMPLE_NOT_OBJECT');
  const sample = raw as Record<string, unknown>;
  for (const key of Object.keys(sample)) {
    if (!['status', 'metrics', 'source_observed_at'].includes(key)) reject('SAMPLE_UNKNOWN_FIELD');
  }
  const status = sample['status'];
  if (typeof status !== 'string' || !(VIEW_STATUSES as readonly string[]).includes(status)) {
    reject('SAMPLE_STATUS_INVALID');
  }
  const metricsRaw = sample['metrics'];
  if (!Array.isArray(metricsRaw) || metricsRaw.length > MAX_METRICS)
    reject('SAMPLE_METRICS_INVALID');
  const seen = new Set<string>();
  const metrics: OpsMetric[] = (metricsRaw as unknown[]).map((m) => {
    if (m === null || typeof m !== 'object' || Array.isArray(m)) reject('METRIC_NOT_OBJECT');
    const metric = m as Record<string, unknown>;
    for (const key of Object.keys(metric)) {
      if (!['metric_code', 'value', 'dimensions'].includes(key)) reject('METRIC_UNKNOWN_FIELD');
    }
    const code = metric['metric_code'];
    const value = metric['value'];
    if (typeof code !== 'string' || !METRIC_CODE.test(code)) reject('METRIC_CODE_INVALID');
    if (typeof value !== 'number' || !Number.isFinite(value)) reject('METRIC_VALUE_INVALID');
    const out: OpsMetric = { metric_code: code, value };
    const dims = metric['dimensions'];
    if (dims !== undefined) {
      if (dims === null || typeof dims !== 'object' || Array.isArray(dims)) {
        reject('DIMENSIONS_NOT_OBJECT');
      }
      const entries = Object.entries(dims as Record<string, unknown>);
      if (entries.length > MAX_DIMENSIONS) reject('DIMENSIONS_TOO_MANY');
      const clean: Record<string, DimensionValue> = {};
      for (const [k, v] of entries) {
        if (!DIMENSION_KEY.test(k) || PERSONAL_DIMENSION.test(k)) reject('DIMENSION_KEY_INVALID');
        if (typeof v === 'string') {
          if (!DIMENSION_CODE_VALUE.test(v) || isUuid(v)) reject('DIMENSION_VALUE_INVALID');
        } else if (typeof v === 'number') {
          if (!Number.isFinite(v)) reject('DIMENSION_VALUE_INVALID');
        } else if (typeof v !== 'boolean') {
          reject('DIMENSION_VALUE_INVALID');
        }
        clean[k] = v;
      }
      out.dimensions = clean;
    }
    const identity = `${code}|${JSON.stringify(out.dimensions ?? {}, Object.keys(out.dimensions ?? {}).sort())}`;
    if (seen.has(identity)) reject('METRIC_DUPLICATE');
    seen.add(identity);
    return out;
  });
  const normalized: PortSample = { status: status as ViewStatus, metrics };
  const observed = sample['source_observed_at'];
  if (observed !== undefined) {
    if (typeof observed !== 'string' || Number.isNaN(Date.parse(observed))) {
      reject('SOURCE_OBSERVED_AT_INVALID');
    }
    normalized.source_observed_at = new Date(observed).toISOString();
  }
  return normalized;
}

export function worstStatus(statuses: readonly ViewStatus[]): ViewStatus {
  if (statuses.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (statuses.includes('DEGRADED')) return 'DEGRADED';
  return 'OK';
}

export function isStale(asOf: string | null, now: Date, maxAgeSeconds: number): boolean {
  if (asOf === null) return true;
  return now.getTime() - Date.parse(asOf) > maxAgeSeconds * 1000;
}

/** Stable resource id for audit and PEP resources of a tenant/view pair (no snapshot required). */
export function viewResourceId(tenantId: string, viewCode: string): string {
  const hex = createHash('sha256').update(`cmp-046|${tenantId}|${viewCode}`).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}
