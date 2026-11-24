/**
 * World-class forms product metrics (CMP-047 adjacent, Workstream 7).
 *
 * Isomorphic: safe for Node BFF and browser Studio/citizen surfaces.
 * Aggregates and category codes only — never form field values, names, mobiles,
 * tokens, or other PII (Constitution #21; SF-CON-ANALYTICS-METRIC intent).
 */

/** Closed vocabulary of product metric codes for forms / Studio claims. */
export const FORMS_PRODUCT_METRIC_CODES = [
  'STUDIO_AUTHORING_SESSION_START',
  'STUDIO_AUTHORING_MILESTONE',
  'STUDIO_AUTHORING_DURATION_MS',
  'CITIZEN_FORM_LOAD_MS',
  'CITIZEN_FORM_STEP',
  'CITIZEN_FORM_SUBMIT_MS',
  'CITIZEN_FORM_COMPLETE',
  'CITIZEN_FORM_ABANDON',
  'A11Y_SCORE_CAPTURE',
  'CROSS_TENANT_INCIDENT',
] as const;

export type FormsProductMetricCode = (typeof FORMS_PRODUCT_METRIC_CODES)[number];

/**
 * Zero cross-tenant incident KPI (world-class claim).
 * Target is absolute zero leakage / forged-tenant acceptance in a period.
 * Automated smoke encodes this as CROSS_TENANT_LEAKAGE === 0.
 */
export const ZERO_CROSS_TENANT_KPI = {
  kpi_id: 'SF-KPI-CROSS-TENANT-ZERO',
  metric_code: 'CROSS_TENANT_INCIDENT' as const,
  name: 'Zero cross-tenant incidents',
  definition:
    'Count of confirmed cross-tenant data disclosure, forged-tenant acceptance, or IDOR leakage on forms/Studio/portal paths in the measurement window.',
  target: 0,
  unit: 'incidents',
  smoke_invariant: 'CROSS_TENANT_LEAKAGE=0',
  fail_closed_codes: ['SF-TEN-002'] as const,
  purpose_code: 'PLATFORM_SECURITY_OPS',
  aggregate_only: true as const,
  raw_pii_payload_forbidden: true as const,
} as const;

/** Attribute keys that must never appear on a product metric event. */
export const PRODUCT_METRIC_FORBIDDEN_KEYS = [
  'authorization',
  'cookie',
  'token',
  'access_token',
  'refresh_token',
  'otp',
  'password',
  'secret',
  'aadhaar',
  'pan',
  'mobile',
  'phone',
  'email',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'address',
  'dob',
  'date_of_birth',
  'document',
  'payload',
  'form_data',
  'answers',
  'prefill',
  'body',
] as const;

const FORBIDDEN = new Set(
  PRODUCT_METRIC_FORBIDDEN_KEYS.map((k) => k.toLowerCase().replace(/[-\s]/g, '_')),
);

const CODE_SET = new Set<string>(FORMS_PRODUCT_METRIC_CODES);

/** Allowed dimension name pattern (CMP-045-aligned facet names). */
const DIMENSION_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Category-code dimension values only (no UUID/PII shapes). */
const CATEGORY_VALUE = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;

export type ProductMetricDimensions = Readonly<Record<string, string | number | boolean>>;

export interface ProductMetricEvent {
  readonly metric_code: FormsProductMetricCode;
  readonly value: number;
  readonly ts: string;
  readonly surface: 'studio' | 'citizen' | 'bff' | 'smoke' | 'lab';
  readonly dimensions: ProductMetricDimensions;
  readonly aggregate_only: true;
  readonly raw_pii_payload_forbidden: true;
}

export interface ProductMetricSink {
  emit(event: ProductMetricEvent): void;
}

export class MemoryProductMetricSink implements ProductMetricSink {
  readonly events: ProductMetricEvent[] = [];
  emit(event: ProductMetricEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}

/**
 * Structured stdout sink for Node lab/CI. Never uses console.* (SAST).
 * Browser environments no-op; pair with MemoryProductMetricSink there.
 */
export class StdoutProductMetricSink implements ProductMetricSink {
  emit(event: ProductMetricEvent): void {
    const line = `${JSON.stringify({ sf_product_metric: true, ...event })}\n`;
    const proc = (globalThis as { process?: { stdout?: { write: (s: string) => unknown } } })
      .process;
    proc?.stdout?.write(line);
  }
}

/** @deprecated Prefer StdoutProductMetricSink — kept as alias for call-site clarity. */
export class ConsoleProductMetricSink extends StdoutProductMetricSink {}

export class MultiplexProductMetricSink implements ProductMetricSink {
  constructor(private readonly sinks: readonly ProductMetricSink[]) {}
  emit(event: ProductMetricEvent): void {
    for (const sink of this.sinks) sink.emit(event);
  }
}

export function isForbiddenProductMetricKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-\s]/g, '_');
  if (FORBIDDEN.has(k)) return true;
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return FORBIDDEN.has(snake);
}

export function isFormsProductMetricCode(code: string): code is FormsProductMetricCode {
  return CODE_SET.has(code);
}

/**
 * Strip forbidden keys and coerce dimension values to safe categories / numbers / booleans.
 * String values that are not category codes become UNCLASSIFIED (never the raw string).
 */
export function sanitizeProductMetricDimensions(
  input: Record<string, unknown> | undefined,
): ProductMetricDimensions {
  if (!input) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [rawKey, rawVal] of Object.entries(input)) {
    if (isForbiddenProductMetricKey(rawKey)) continue;
    if (!DIMENSION_NAME.test(rawKey)) continue;
    if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      out[rawKey] = rawVal;
      continue;
    }
    if (typeof rawVal === 'boolean') {
      out[rawKey] = rawVal;
      continue;
    }
    if (typeof rawVal === 'string') {
      out[rawKey] = CATEGORY_VALUE.test(rawVal) ? rawVal : 'UNCLASSIFIED';
    }
  }
  return out;
}

export function createProductMetricEvent(input: {
  metric_code: FormsProductMetricCode;
  value: number;
  surface: ProductMetricEvent['surface'];
  dimensions?: Record<string, unknown>;
  ts?: string;
}): ProductMetricEvent {
  if (!isFormsProductMetricCode(input.metric_code)) {
    throw new Error('UNKNOWN_PRODUCT_METRIC_CODE');
  }
  if (!Number.isFinite(input.value)) {
    throw new Error('PRODUCT_METRIC_VALUE_NOT_FINITE');
  }
  return {
    metric_code: input.metric_code,
    value: input.value,
    ts: input.ts ?? new Date().toISOString(),
    surface: input.surface,
    dimensions: sanitizeProductMetricDimensions(input.dimensions),
    aggregate_only: true,
    raw_pii_payload_forbidden: true,
  };
}

export interface ProductMetricsRecorder {
  record(input: {
    metric_code: FormsProductMetricCode;
    value: number;
    surface: ProductMetricEvent['surface'];
    dimensions?: Record<string, unknown>;
  }): ProductMetricEvent;
  sink: ProductMetricSink;
}

export function createProductMetricsRecorder(sink: ProductMetricSink): ProductMetricsRecorder {
  return {
    sink,
    record(input) {
      const event = createProductMetricEvent(input);
      sink.emit(event);
      return event;
    },
  };
}

/** Nearest-rank percentile for a sorted ascending sample. */
export function percentile(sortedAscending: readonly number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  if (p <= 0) return sortedAscending[0] ?? null;
  if (p >= 100) return sortedAscending[sortedAscending.length - 1] ?? null;
  const rank = Math.ceil((p / 100) * sortedAscending.length) - 1;
  const idx = Math.min(Math.max(rank, 0), sortedAscending.length - 1);
  return sortedAscending[idx] ?? null;
}

export function p95(samplesMs: readonly number[]): number | null {
  const sorted = [...samplesMs].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  return percentile(sorted, 95);
}

export function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Opaque session id for correlation of metric events — not a person id. */
export function newMetricSessionId(): string {
  const c = globalThis.crypto as
    { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined;
  if (c?.randomUUID) {
    return c.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(8);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('SECURE_RANDOM_UNAVAILABLE');
}
