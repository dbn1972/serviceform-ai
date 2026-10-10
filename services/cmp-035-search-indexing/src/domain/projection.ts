import { Cmp035Error, detail } from '../errors.js';
import { FACET_NAME_RE, MAX_FACETS, isFacetValue, type Facets } from './document.js';
import {
  CMP_ID_RE,
  EVENT_TYPE_RE,
  RESOURCE_TYPE_RE,
  TOPIC_RE,
  isPlainObject,
  isUuid,
} from './validate.js';

/**
 * Published index projection rule (metadata resolved through ProjectionRulePort, pinned by
 * rule_id + rule_version). It names which facets are copied from an event's data. Nothing
 * outside the declared facets is stored.
 */
export interface ProjectionRule {
  rule_id: string;
  rule_version: number;
  status: 'PUBLISHED';
  source_cmp_id: string;
  topic: string;
  aggregate_type: string;
  upsert_event_types: string[];
  remove_event_types: string[];
  facets: FacetRule[];
}

export interface FacetRule {
  name: string;
  path: string;
  required: boolean;
}

export type ProjectionAction = 'UPSERT' | 'REMOVE';

const PATH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_PATH_DEPTH = 8;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const RULE_KEYS = [
  'rule_id',
  'rule_version',
  'status',
  'source_cmp_id',
  'topic',
  'aggregate_type',
  'upsert_event_types',
  'remove_event_types',
  'facets',
] as const;

export function isFacetPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const segments = value.split('.');
  return (
    segments.length >= 1 &&
    segments.length <= MAX_PATH_DEPTH &&
    segments.every((s) => PATH_SEGMENT_RE.test(s) && !FORBIDDEN_SEGMENTS.has(s))
  );
}

function isFacetRule(value: unknown): value is FacetRule {
  return (
    isPlainObject(value) &&
    Object.keys(value).every((k) => ['name', 'path', 'required'].includes(k)) &&
    typeof value['name'] === 'string' &&
    FACET_NAME_RE.test(value['name']) &&
    isFacetPath(value['path']) &&
    typeof value['required'] === 'boolean'
  );
}

function isEventTypeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((t) => typeof t === 'string' && EVENT_TYPE_RE.test(t)) &&
    new Set(value).size === value.length
  );
}

export function isProjectionRule(value: unknown): value is ProjectionRule {
  if (!isPlainObject(value)) return false;
  if (!Object.keys(value).every((k) => (RULE_KEYS as readonly string[]).includes(k))) return false;
  const v = value;
  if (!isUuid(v['rule_id'])) return false;
  if (!Number.isInteger(v['rule_version']) || (v['rule_version'] as number) < 1) return false;
  if (v['status'] !== 'PUBLISHED') return false;
  if (typeof v['source_cmp_id'] !== 'string' || !CMP_ID_RE.test(v['source_cmp_id'])) return false;
  if (typeof v['topic'] !== 'string' || !TOPIC_RE.test(v['topic'])) return false;
  if (typeof v['aggregate_type'] !== 'string' || !RESOURCE_TYPE_RE.test(v['aggregate_type'])) {
    return false;
  }
  if (!isEventTypeList(v['upsert_event_types']) || v['upsert_event_types'].length === 0) {
    return false;
  }
  if (!isEventTypeList(v['remove_event_types'])) return false;
  const removes = v['remove_event_types'];
  if (v['upsert_event_types'].some((t) => removes.includes(t))) return false;
  const facets = v['facets'];
  if (!Array.isArray(facets) || facets.length > MAX_FACETS || !facets.every(isFacetRule)) {
    return false;
  }
  return new Set(facets.map((f) => f.name)).size === facets.length;
}

export function classifyEvent(rule: ProjectionRule, eventType: string): ProjectionAction | null {
  if (rule.upsert_event_types.includes(eventType)) return 'UPSERT';
  if (rule.remove_event_types.includes(eventType)) return 'REMOVE';
  return null;
}

/** Read-only, own-property traversal; never assigns into the event payload. */
function readPath(data: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        isPlainObject(node) ? Object.getOwnPropertyDescriptor(node, segment)?.value : undefined,
      data,
    );
}

/** Copies only declared scalar facets; anything else in the event payload is discarded. */
export function projectFacets(rule: ProjectionRule, data: Record<string, unknown>): Facets {
  const facets: Facets = {};
  for (const f of rule.facets) {
    const value = readPath(data, f.path);
    if (value === undefined || value === null) {
      if (f.required) {
        throw new Cmp035Error('SF-SYS-003', {
          details: detail('REQUIRED_FACET_MISSING', `/data/${f.path.replaceAll('.', '/')}`),
        });
      }
      continue;
    }
    if (!isFacetValue(value)) {
      throw new Cmp035Error('SF-SYS-003', {
        details: detail('FACET_VALUE_NOT_SCALAR', `/data/${f.path.replaceAll('.', '/')}`),
      });
    }
    facets[f.name] = value;
  }
  return facets;
}
