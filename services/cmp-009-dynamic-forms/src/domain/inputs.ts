import { Cmp009Error } from '../errors.js';
import {
  canonicalJson,
  CONTENT_HASH_RE,
  FORM_KEY_RE,
  isLocaleTag,
  isUuid,
  PURPOSE_CODE_RE,
} from './canonical.js';

export const MAX_DATA_BYTES = 65_536;
const MAX_DEPTH = 12;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface FormPin {
  form_key: string;
  version_id: string;
  content_hash: string;
}

export interface ExecutionRequest {
  form: FormPin;
  data: Record<string, unknown>;
  purpose_code: string;
  locale: string;
}

function bad(code: string): never {
  throw new Cmp009Error('SF-SYS-003', { details: [{ code }] });
}

function assertPlainJson(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) bad('DATA_TOO_DEEP');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) bad('DATA_NOT_FINITE');
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) assertPlainJson(v, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) bad('DATA_KEY_FORBIDDEN');
      assertPlainJson(v, depth + 1);
    }
    return;
  }
  bad('DATA_NOT_JSON');
}

function parsePin(pack: unknown): FormPin {
  if (typeof pack !== 'object' || pack === null || Array.isArray(pack)) bad('FORM_PIN_REQUIRED');
  const p = pack as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (k !== 'form_key' && k !== 'version_id' && k !== 'content_hash')
      bad('FORM_PIN_FIELD_UNKNOWN');
  }
  const formKey = p['form_key'];
  const versionId = p['version_id'];
  const contentHash = p['content_hash'];
  if (typeof formKey !== 'string' || !FORM_KEY_RE.test(formKey)) bad('FORM_KEY_INVALID');
  if (!isUuid(versionId)) bad('VERSION_ID_INVALID');
  if (typeof contentHash !== 'string' || !CONTENT_HASH_RE.test(contentHash)) {
    bad('CONTENT_HASH_INVALID');
  }
  return { form_key: formKey, version_id: versionId, content_hash: contentHash };
}

export function parseExecutionRequest(body: unknown): ExecutionRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) bad('BODY_NOT_OBJECT');
  const b = body as Record<string, unknown>;
  const allowed = new Set(['form', 'data', 'purpose_code', 'locale']);
  for (const k of Object.keys(b)) if (!allowed.has(k)) bad('BODY_FIELD_UNKNOWN');
  const purpose = b['purpose_code'];
  if (typeof purpose !== 'string' || !PURPOSE_CODE_RE.test(purpose)) bad('PURPOSE_CODE_INVALID');
  const locale = b['locale'];
  if (typeof locale !== 'string' || !isLocaleTag(locale)) bad('LOCALE_INVALID');
  const data = b['data'];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) bad('DATA_REQUIRED');
  assertPlainJson(data, 0);
  if (Buffer.byteLength(canonicalJson(data), 'utf8') > MAX_DATA_BYTES) bad('DATA_TOO_LARGE');
  return {
    form: parsePin(b['form']),
    data: data as Record<string, unknown>,
    purpose_code: purpose,
    locale,
  };
}

export function parseInterpretationRequest(body: unknown): {
  form: FormPin;
  data: Record<string, unknown>;
  locale: string;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) bad('BODY_NOT_OBJECT');
  const b = body as Record<string, unknown>;
  const allowed = new Set(['form', 'data', 'locale']);
  for (const k of Object.keys(b)) if (!allowed.has(k)) bad('BODY_FIELD_UNKNOWN');
  const locale = b['locale'];
  if (typeof locale !== 'string' || !isLocaleTag(locale)) bad('LOCALE_INVALID');
  const data = b['data'] ?? {};
  if (typeof data !== 'object' || data === null || Array.isArray(data)) bad('DATA_INVALID');
  assertPlainJson(data, 0);
  return { form: parsePin(b['form']), data: data as Record<string, unknown>, locale };
}
