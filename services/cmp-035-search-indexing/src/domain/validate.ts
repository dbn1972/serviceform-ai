import { createHash } from 'node:crypto';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CELL_ID_RE = /^cell-[a-z0-9-]{1,40}$/;
export const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const TRACE_ID_RE = /^[0-9a-f]{32}$/;
export const EVENT_TYPE_RE = /^[A-Z][A-Za-z0-9]{2,79}$/;
export const RESOURCE_TYPE_RE = /^[A-Z][A-Za-z0-9]{1,63}$/;
export const CMP_ID_RE = /^CMP-[0-9]{3}$/;
export const TOPIC_RE = /^[a-zA-Z0-9._-]{3,249}$/;

export const ACTOR_TYPES = [
  'CITIZEN',
  'OFFICER',
  'SYSTEM',
  'INTEGRATION',
  'PRIVILEGED_ADMIN',
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export const AUTH_ASSURANCES = ['NONE', 'OTP', 'PASSWORD', 'MFA', 'WORKLOAD_IDENTITY'] as const;
export type AuthAssurance = (typeof AUTH_ASSURANCES)[number];

export interface Actor {
  type: ActorType;
  id: string;
}

export interface RequestContext {
  tenant_id: string | null;
  cell_id: string;
  actor: Actor;
  organisation_id?: string;
  office_id?: string;
  roles: string[];
  jurisdiction_ids: string[];
  delegation_id?: string;
  auth_assurance: AuthAssurance;
  correlation_id: string;
  trace_id: string;
  purpose?: string;
}

export interface TenantRequestContext extends RequestContext {
  tenant_id: string;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_RE.test(value);
}

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}$/;
const FRACTION_RE = /^\.\d{1,9}$/;
const OFFSET_RE = /^(?:[Zz]|[+-]\d{2}:\d{2})$/;

/** RFC 3339 date-time with an explicit offset, checked in bounded pieces (no backtracking). */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return false;
  if (!DATE_TIME_RE.test(value.slice(0, 19))) return false;
  const rest = value.slice(19);
  const offsetAt = rest.search(/[Zz+-]/);
  if (offsetAt < 0) return false;
  const fraction = rest.slice(0, offsetAt);
  if (fraction !== '' && !FRACTION_RE.test(fraction)) return false;
  return OFFSET_RE.test(rest.slice(offsetAt)) && !Number.isNaN(Date.parse(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((k) => allowed.includes(k));
}

function uniqueArrayOf(value: unknown, test: (v: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(test) && new Set(value).size === value.length;
}

const REQUEST_CONTEXT_KEYS = [
  'tenant_id',
  'cell_id',
  'actor',
  'organisation_id',
  'office_id',
  'roles',
  'jurisdiction_ids',
  'delegation_id',
  'auth_assurance',
  'correlation_id',
  'trace_id',
  'purpose',
] as const;

export function isActor(value: unknown): value is Actor {
  return (
    isObject(value) &&
    onlyKeys(value, ['type', 'id']) &&
    (ACTOR_TYPES as readonly unknown[]).includes(value['type']) &&
    isUuid(value['id'])
  );
}

export function isRequestContext(value: unknown): value is RequestContext {
  if (!isObject(value) || !onlyKeys(value, REQUEST_CONTEXT_KEYS)) return false;
  const v = value;
  if (!(v['tenant_id'] === null || isUuid(v['tenant_id']))) return false;
  if (typeof v['cell_id'] !== 'string' || !CELL_ID_RE.test(v['cell_id'])) return false;
  if (!isActor(v['actor'])) return false;
  if (!uniqueArrayOf(v['roles'], isCode)) return false;
  if (!uniqueArrayOf(v['jurisdiction_ids'], isUuid)) return false;
  if (!(AUTH_ASSURANCES as readonly unknown[]).includes(v['auth_assurance'])) return false;
  if (!isUuid(v['correlation_id'])) return false;
  if (typeof v['trace_id'] !== 'string' || !TRACE_ID_RE.test(v['trace_id'])) return false;
  for (const k of ['organisation_id', 'office_id', 'delegation_id'] as const) {
    if (v[k] !== undefined && !isUuid(v[k])) return false;
  }
  if (v['purpose'] !== undefined && !isCode(v['purpose'])) return false;
  if ((v['actor'] as Actor).type === 'INTEGRATION' && v['purpose'] === undefined) return false;
  return true;
}

export interface AuthzDecisionOutput {
  allow: boolean;
  reason_code: string;
  policy_revision: string;
  decision_id: string;
}

export function isAuthzDecisionOutput(value: unknown): value is AuthzDecisionOutput {
  return (
    isObject(value) &&
    onlyKeys(value, ['allow', 'reason_code', 'policy_revision', 'decision_id']) &&
    typeof value['allow'] === 'boolean' &&
    isCode(value['reason_code']) &&
    typeof value['policy_revision'] === 'string' &&
    value['policy_revision'].length >= 1 &&
    value['policy_revision'].length <= 128 &&
    isUuid(value['decision_id'])
  );
}

export interface EventEnvelope<T extends object = Record<string, unknown>> {
  event_id: string;
  event_type: string;
  schema_version: number;
  tenant_id: string | null;
  cell_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  correlation_id: string;
  causation_id?: string;
  actor: Actor;
  data: T;
}

const ENVELOPE_KEYS = [
  'event_id',
  'event_type',
  'schema_version',
  'tenant_id',
  'cell_id',
  'aggregate_type',
  'aggregate_id',
  'aggregate_version',
  'occurred_at',
  'correlation_id',
  'causation_id',
  'actor',
  'data',
] as const;

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (!isObject(value) || !onlyKeys(value, ENVELOPE_KEYS)) return false;
  const v = value;
  return (
    isUuid(v['event_id']) &&
    typeof v['event_type'] === 'string' &&
    EVENT_TYPE_RE.test(v['event_type']) &&
    Number.isInteger(v['schema_version']) &&
    (v['schema_version'] as number) >= 1 &&
    (v['tenant_id'] === null || isUuid(v['tenant_id'])) &&
    typeof v['cell_id'] === 'string' &&
    CELL_ID_RE.test(v['cell_id']) &&
    typeof v['aggregate_type'] === 'string' &&
    RESOURCE_TYPE_RE.test(v['aggregate_type']) &&
    isUuid(v['aggregate_id']) &&
    Number.isInteger(v['aggregate_version']) &&
    (v['aggregate_version'] as number) >= 0 &&
    isIsoTimestamp(v['occurred_at']) &&
    isUuid(v['correlation_id']) &&
    (v['causation_id'] === undefined || isUuid(v['causation_id'])) &&
    isActor(v['actor']) &&
    isObject(v['data'])
  );
}

export type AuditActionClass = 'READ' | 'WRITE' | 'DECISION' | 'OVERRIDE' | 'PRIVILEGED';
export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED';

export interface AuditEvent {
  audit_id: string;
  occurred_at: string;
  tenant_id: string | null;
  cell_id: string;
  actor_type: ActorType;
  actor_id: string;
  organisation_id?: string;
  office_id?: string;
  jurisdiction_id?: string;
  action: string;
  action_class?: AuditActionClass;
  resource_type: string;
  resource_id: string;
  before_ref?: string;
  after_ref?: string;
  reason?: string;
  correlation_id: string;
  trace_id: string;
  result: AuditResult;
  classification?: 'TENANT_SCOPED';
}

export function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isObject(value)) return false;
  const v = value;
  const decisionLike = ['DECISION', 'OVERRIDE', 'PRIVILEGED'].includes(String(v['action_class']));
  return (
    isUuid(v['audit_id']) &&
    isIsoTimestamp(v['occurred_at']) &&
    (v['tenant_id'] === null || isUuid(v['tenant_id'])) &&
    typeof v['cell_id'] === 'string' &&
    CELL_ID_RE.test(v['cell_id']) &&
    (ACTOR_TYPES as readonly unknown[]).includes(v['actor_type']) &&
    isUuid(v['actor_id']) &&
    isCode(v['action']) &&
    typeof v['resource_type'] === 'string' &&
    RESOURCE_TYPE_RE.test(v['resource_type']) &&
    typeof v['resource_id'] === 'string' &&
    v['resource_id'].length >= 1 &&
    v['resource_id'].length <= 128 &&
    isUuid(v['correlation_id']) &&
    typeof v['trace_id'] === 'string' &&
    TRACE_ID_RE.test(v['trace_id']) &&
    ['SUCCESS', 'DENIED', 'FAILED'].includes(String(v['result'])) &&
    (!decisionLike || (typeof v['reason'] === 'string' && v['reason'].length >= 1))
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Of(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isObject(value);
}
