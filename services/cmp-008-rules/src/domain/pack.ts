import { Cmp008Error } from '../errors.js';
import { PACK_KEY_RE } from './canonical.js';
import { validateJdm, type Jdm } from './jdm.js';

export const OUTCOME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const REASON_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const MAX_REASON_CODES = 32;
const OUTCOME_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export interface RulePack {
  rulePackId: string;
  jdm: Jdm;
  outcomeField: string | null;
  reasonCodesField: string | null;
}

function bad(code: string): never {
  throw new Cmp008Error('SF-RULE-001', { statusCode: 422, details: [{ code }] });
}

/**
 * Parses a published RULES metadata payload (CMP-033 kind RULES: rule_pack_id + engine GORULES).
 * The decision graph (jdm) is authored in Studio; nothing is defined here per service.
 */
export function parseRulePack(payload: unknown, expectedPackKey: string): RulePack {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    bad('RULE_PACK_NOT_OBJECT');
  }
  const p = payload as Record<string, unknown>;
  const id = p['rule_pack_id'];
  if (typeof id !== 'string' || !PACK_KEY_RE.test(id)) bad('RULE_PACK_ID_INVALID');
  if (id !== expectedPackKey) bad('RULE_PACK_KEY_MISMATCH');
  if (p['engine'] !== 'GORULES') bad('RULE_PACK_ENGINE_UNSUPPORTED');
  const field = p['outcome_field'];
  if (field !== undefined && (typeof field !== 'string' || !OUTCOME_FIELD_RE.test(field))) {
    bad('RULE_PACK_OUTCOME_FIELD_INVALID');
  }
  const reasonField = p['reason_codes_field'];
  if (
    reasonField !== undefined &&
    (typeof reasonField !== 'string' || !OUTCOME_FIELD_RE.test(reasonField))
  ) {
    bad('RULE_PACK_REASON_FIELD_INVALID');
  }
  return {
    rulePackId: id,
    reasonCodesField: typeof reasonField === 'string' ? reasonField : null,
    jdm: validateJdm(p['jdm']),
    outcomeField: typeof field === 'string' ? field : null,
  };
}
