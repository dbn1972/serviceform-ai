import { canonicalJson } from '../domain/fingerprint.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp020Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'issued_at',
  'as_of',
]);

/**
 * Fields a client could use to dictate the fee outcome. Amounts, currency, waivers and version
 * pins are platform-derived (SF-CON-FEE-QUOTE: client_authoritative_amount is always false).
 */
export const CLIENT_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  'amount',
  'amount_minor',
  'total',
  'total_amount',
  'total_amount_minor',
  'line_items',
  'lines',
  'currency',
  'amount_source',
  'client_authoritative_amount',
  'calculation_basis',
  'waiver',
  'waiver_policy_ref',
  'exemption',
  'fee_policy_version_id',
  'rule_version_id',
  'tenant_service_binding_id',
  'tenant_id',
]);

const FACT_KEY = /^[a-z][a-z0-9_]{0,63}$/;
/** Facts are deterministic rule inputs, not outcomes: names that read as fee outcomes are refused. */
const FACT_OUTCOME_KEY = /(amount|fee|total|waiver|exempt|discount|charge|price)/;
export const MAX_FACTS = 64;
export const MAX_FACTS_BYTES = 16_384;

export interface QuoteInput {
  application_id: string;
  facts: Record<string, unknown>;
}

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp020Error('SF-SYS-003', detail(code, pointer));
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp020Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function isFactValue(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 3) return false;
  if (Array.isArray(value))
    return value.length <= 64 && value.every((v) => isFactValue(v, depth + 1));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((v) => isFactValue(v, depth + 1));
  }
  return false;
}

function parseFacts(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) bad('/facts', 'FACTS_OBJECT_REQUIRED');
  const facts = raw as Record<string, unknown>;
  const keys = Object.keys(facts);
  if (keys.length > MAX_FACTS) bad('/facts', 'FACTS_TOO_MANY');
  for (const key of keys) {
    if (!FACT_KEY.test(key)) bad(`/facts/${key}`, 'FACT_KEY_INVALID');
    if (FACT_OUTCOME_KEY.test(key)) bad(`/facts/${key}`, 'CLIENT_AMOUNT_FORBIDDEN');
    if (!isFactValue(facts[key], 0)) bad(`/facts/${key}`, 'FACT_VALUE_INVALID');
  }
  if (Buffer.byteLength(canonicalJson(facts), 'utf8') > MAX_FACTS_BYTES) {
    bad('/facts', 'FACTS_TOO_LARGE');
  }
  return facts;
}

export function validateQuoteInput(body: unknown): QuoteInput {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  for (const key of Object.keys(rec)) {
    if (CLIENT_AUTHORITY_KEYS.has(key)) bad(`/${key}`, 'CLIENT_AMOUNT_FORBIDDEN');
    if (key !== 'application_id' && key !== 'facts') bad(`/${key}`, 'UNKNOWN_FIELD');
  }
  const applicationId = rec['application_id'];
  if (typeof applicationId !== 'string' || !isUuid(applicationId)) {
    bad('/application_id', 'UUID_REQUIRED');
  }
  return { application_id: applicationId, facts: parseFacts(rec['facts']) };
}

export function validateEmptyInput(body: unknown): void {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  if (Object.keys(rec).length > 0) bad(`/${Object.keys(rec)[0] as string}`, 'UNKNOWN_FIELD');
}
