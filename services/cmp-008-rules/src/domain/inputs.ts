import { Cmp008Error } from '../errors.js';
import {
  canonicalJson,
  CONTENT_HASH_RE,
  isUuid,
  PACK_KEY_RE,
  PURPOSE_CODE_RE,
  SUBJECT_REF_RE,
} from './canonical.js';

export const MAX_INPUT_BYTES = 65_536;
export const MAX_OUTPUT_BYTES = 65_536;
const MAX_DEPTH = 12;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface RulePackPin {
  pack_key: string;
  version_id: string;
  content_hash: string;
}

export interface EvaluationRequest {
  rule_pack: RulePackPin;
  inputs: Record<string, unknown>;
  purpose_code: string;
  subject_ref?: string;
}

function bad(code: string): never {
  throw new Cmp008Error('SF-SYS-003', { details: [{ code }] });
}

function assertPlainJson(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) bad('INPUTS_TOO_DEEP');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) bad('INPUTS_NOT_FINITE');
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) assertPlainJson(v, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) bad('INPUTS_KEY_FORBIDDEN');
      assertPlainJson(v, depth + 1);
    }
    return;
  }
  bad('INPUTS_NOT_JSON');
}

export function parseEvaluationRequest(body: unknown): EvaluationRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) bad('BODY_NOT_OBJECT');
  const b = body as Record<string, unknown>;
  const allowed = new Set(['rule_pack', 'inputs', 'purpose_code', 'subject_ref']);
  for (const k of Object.keys(b)) if (!allowed.has(k)) bad('BODY_FIELD_UNKNOWN');

  const pack = b['rule_pack'];
  if (typeof pack !== 'object' || pack === null || Array.isArray(pack)) bad('RULE_PACK_REQUIRED');
  const p = pack as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (k !== 'pack_key' && k !== 'version_id' && k !== 'content_hash')
      bad('RULE_PACK_FIELD_UNKNOWN');
  }
  const packKey = p['pack_key'];
  const versionId = p['version_id'];
  const contentHash = p['content_hash'];
  if (typeof packKey !== 'string' || !PACK_KEY_RE.test(packKey)) bad('PACK_KEY_INVALID');
  if (!isUuid(versionId)) bad('VERSION_ID_INVALID');
  if (typeof contentHash !== 'string' || !CONTENT_HASH_RE.test(contentHash)) {
    bad('CONTENT_HASH_INVALID');
  }

  const purpose = b['purpose_code'];
  if (typeof purpose !== 'string' || !PURPOSE_CODE_RE.test(purpose)) bad('PURPOSE_CODE_INVALID');

  const inputs = b['inputs'];
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs))
    bad('INPUTS_REQUIRED');
  assertPlainJson(inputs, 0);
  if (Buffer.byteLength(canonicalJson(inputs), 'utf8') > MAX_INPUT_BYTES) bad('INPUTS_TOO_LARGE');

  const subject = b['subject_ref'];
  if (subject !== undefined && (typeof subject !== 'string' || !SUBJECT_REF_RE.test(subject))) {
    bad('SUBJECT_REF_INVALID');
  }
  return {
    rule_pack: { pack_key: packKey, version_id: versionId, content_hash: contentHash },
    inputs: inputs as Record<string, unknown>,
    purpose_code: purpose,
    ...(typeof subject === 'string' ? { subject_ref: subject } : {}),
  };
}
