import { PERIOD_GRANULARITIES, type PeriodGranularity } from '../domain/period.js';
import { isCategoryCode, isIdentifyingFieldName, isValidFieldName } from '../domain/privacy.js';
import type { Aggregation, DimensionSpec } from '../domain/projection.js';
import { parseIsoInstant } from '../domain/timestamp.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp045Error, detail } from '../errors.js';

const METRIC_CODE = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;
const PURPOSE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const EVENT_TYPE = /^[A-Z][A-Za-z0-9]{2,79}$/;
const AGGREGATE_TYPE = /^[A-Z][A-Za-z0-9]{1,63}$/;
const AGGREGATIONS = ['COUNT', 'SUM'] as const;

export const MAX_DIMENSIONS = 6;
export const MAX_ALLOWED_VALUES = 200;
export const MAX_MIN_COHORT = 100_000;
export const DEFAULT_QUERY_LIMIT = 500;
export const MAX_QUERY_LIMIT = 2000;

export interface DefinitionInput {
  metric_code: string;
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
}

export interface ParsedMetricQuery {
  metric_code: string;
  period_from: string | null;
  period_to: string | null;
  dimensions: Record<string, string | boolean>;
  purpose_code: string | null;
  limit: number;
}

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp045Error('SF-SYS-003', detail(code, pointer));
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_MUST_BE_OBJECT');
  return value as Record<string, unknown>;
}

/** Tenant, actor and time are server-derived; any unlisted member is refused, not ignored. */
function allowOnly(obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_PROPERTY');
  }
}

function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') bad(`/${key}`, 'STRING_REQUIRED');
  return v as string;
}

function pattern(obj: Record<string, unknown>, key: string, re: RegExp, code: string): string {
  const v = str(obj, key);
  if (!re.test(v)) bad(`/${key}`, code);
  return v;
}

function int(obj: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    bad(`/${key}`, 'INTEGER_RANGE');
  }
  return v as number;
}

function oneOf<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const v = str(obj, key);
  if (!(allowed as readonly string[]).includes(v)) bad(`/${key}`, 'ENUM');
  return v as T;
}

function fieldName(value: unknown, pointer: string): string {
  if (typeof value !== 'string' || !isValidFieldName(value)) bad(pointer, 'FIELD_NAME_PATTERN');
  if (isIdentifyingFieldName(value as string)) bad(pointer, 'IDENTIFYING_FIELD_REFUSED');
  return value as string;
}

function parseDimensions(raw: unknown): DimensionSpec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_DIMENSIONS) bad('/dimensions', 'LIST_INVALID');
  const seen = new Set<string>();
  return (raw as unknown[]).map((entry, i) => {
    const o = asRecord(entry);
    const at = `/dimensions/${i}`;
    for (const key of Object.keys(o)) {
      if (!['key', 'source_field', 'allowed_values'].includes(key)) {
        bad(`${at}/${key}`, 'UNKNOWN_PROPERTY');
      }
    }
    const key = fieldName(o['key'], `${at}/key`);
    if (seen.has(key)) bad(`${at}/key`, 'DUPLICATE_DIMENSION_KEY');
    seen.add(key);
    const spec: DimensionSpec = {
      key,
      source_field: fieldName(o['source_field'], `${at}/source_field`),
    };
    if (o['allowed_values'] !== undefined) {
      const values = o['allowed_values'];
      if (
        !Array.isArray(values) ||
        values.length < 1 ||
        values.length > MAX_ALLOWED_VALUES ||
        !values.every((v) => typeof v === 'string' && isCategoryCode(v)) ||
        new Set(values).size !== values.length
      ) {
        bad(`${at}/allowed_values`, 'CATEGORY_CODES_REQUIRED');
      }
      spec.allowed_values = [...(values as string[])];
    }
    return spec;
  });
}

export function validateDefinitionInput(input: unknown): DefinitionInput {
  const obj = asRecord(input);
  allowOnly(obj, [
    'metric_code',
    'publication_ref',
    'purpose_code',
    'source_event_type',
    'source_aggregate_type',
    'source_schema_version',
    'aggregation',
    'value_field',
    'period_granularity',
    'dimensions',
    'min_cohort_size',
  ]);
  const ref = str(obj, 'publication_ref');
  if (ref.length < 3 || ref.length > 200) bad('/publication_ref', 'LENGTH');
  const aggregation = oneOf(obj, 'aggregation', AGGREGATIONS);
  const rawValueField = obj['value_field'];
  let valueField: string | null = null;
  if (rawValueField !== undefined && rawValueField !== null) {
    valueField = fieldName(rawValueField, '/value_field');
  }
  if (aggregation === 'SUM' && valueField === null) bad('/value_field', 'VALUE_FIELD_REQUIRED');
  if (aggregation === 'COUNT' && valueField !== null)
    bad('/value_field', 'VALUE_FIELD_NOT_ALLOWED');
  let aggregateType: string | null = null;
  const rawAggregate = obj['source_aggregate_type'];
  if (rawAggregate !== undefined && rawAggregate !== null) {
    aggregateType = pattern(obj, 'source_aggregate_type', AGGREGATE_TYPE, 'AGGREGATE_TYPE_PATTERN');
  }
  return {
    metric_code: pattern(obj, 'metric_code', METRIC_CODE, 'CODE_PATTERN'),
    publication_ref: ref,
    purpose_code: pattern(obj, 'purpose_code', PURPOSE_CODE, 'CODE_PATTERN'),
    source_event_type: pattern(obj, 'source_event_type', EVENT_TYPE, 'EVENT_TYPE_PATTERN'),
    source_aggregate_type: aggregateType,
    source_schema_version: int(obj, 'source_schema_version', 1, 1000),
    aggregation,
    value_field: valueField,
    period_granularity: oneOf(obj, 'period_granularity', PERIOD_GRANULARITIES),
    dimensions: parseDimensions(obj['dimensions']),
    min_cohort_size: int(obj, 'min_cohort_size', 1, MAX_MIN_COHORT),
  };
}

export function validateEmptyInput(input: unknown): Record<string, never> {
  allowOnly(asRecord(input), []);
  return {};
}

function queryString(
  query: Readonly<Record<string, string | string[] | undefined>>,
  key: string,
): string | null {
  const v = query[key];
  if (v === undefined) return null;
  if (Array.isArray(v)) bad(`/query/${key}`, 'SINGLE_VALUE_REQUIRED');
  return v as string;
}

function instant(value: string | null, pointer: string): string | null {
  if (value === null) return null;
  const t = parseIsoInstant(value);
  if (t === null) bad(pointer, 'TIMESTAMP_REQUIRED');
  return new Date(t as number).toISOString();
}

/**
 * `period_from` / `period_to` select report windows and are not a time source: they never reach
 * a stored value. Dimension filters are `dim.<key>=<CATEGORY_CODE>`.
 */
export function parseMetricQuery(
  query: Readonly<Record<string, string | string[] | undefined>>,
): ParsedMetricQuery {
  const known = new Set(['metric_code', 'period_from', 'period_to', 'purpose_code', 'limit']);
  const dimensions: Record<string, string | boolean> = {};
  for (const key of Object.keys(query)) {
    if (key.startsWith('dim.')) {
      const name = key.slice(4);
      if (!isValidFieldName(name)) bad(`/query/${key}`, 'FIELD_NAME_PATTERN');
      const value = queryString(query, key);
      if (value === 'true' || value === 'false') dimensions[name] = value === 'true';
      else if (value !== null && isCategoryCode(value)) dimensions[name] = value;
      else bad(`/query/${key}`, 'CATEGORY_CODE_REQUIRED');
    } else if (!known.has(key)) {
      bad(`/query/${key}`, 'UNKNOWN_PROPERTY');
    }
  }
  const metricCode = queryString(query, 'metric_code');
  if (metricCode === null || !METRIC_CODE.test(metricCode))
    bad('/query/metric_code', 'CODE_PATTERN');
  const purpose = queryString(query, 'purpose_code');
  if (purpose !== null && !PURPOSE_CODE.test(purpose)) bad('/query/purpose_code', 'CODE_PATTERN');
  const limitRaw = queryString(query, 'limit');
  let limit = DEFAULT_QUERY_LIMIT;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
      bad('/query/limit', 'INTEGER_RANGE');
    }
  }
  return {
    metric_code: metricCode as string,
    period_from: instant(queryString(query, 'period_from'), '/query/period_from'),
    period_to: instant(queryString(query, 'period_to'), '/query/period_to'),
    dimensions,
    purpose_code: purpose,
    limit,
  };
}

export function parseUuidParam(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value as string;
}
