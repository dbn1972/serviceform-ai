import { Cmp019Error, detail } from '../errors.js';
import { isCode, isRef, type EvidenceLinkInput, type RequestedItemInput } from '../domain/model.js';
import { isUuid } from '../domain/uuid.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'opened_at',
  'responded_at',
  'closed_at',
  'attached_at',
  'as_of',
]);

export interface OpenInput {
  application_id: string;
  reason_code: string;
  notice_code: string;
  instruction_ref: string;
  sla_pause_reason_code: string;
  sla_stage_code: string;
  response_due_at: string | null;
  case_expected_state: string;
  case_expected_version: number;
  items: RequestedItemInput[];
  evidence: EvidenceLinkInput[];
}

export interface RespondInput {
  narrative_ref: string;
  provided_item_codes: string[];
  evidence: EvidenceLinkInput[];
  case_expected_state: string;
  case_expected_version: number;
}

export interface CloseInput {
  close_reason_code: string;
}

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp019Error('SF-SYS-003', detail(code, pointer));
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp019Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function requireUuid(value: unknown, pointer: string): string {
  if (typeof value !== 'string' || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value;
}

function requireCode(value: unknown, pointer: string): string {
  if (!isCode(value)) bad(pointer, 'CODE_REQUIRED');
  return value;
}

function requireRef(value: unknown, pointer: string): string {
  if (!isRef(value)) bad(pointer, 'REF_REQUIRED');
  return value;
}

function optionalDue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) bad('/response_due_at', 'DUE_AT_INVALID');
  return new Date(value).toISOString();
}

function parseItems(raw: unknown): RequestedItemInput[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 32) bad('/items', 'ITEMS_REQUIRED');
  return raw.map((item, i) => {
    const rec = asRecord(item);
    assertNoClientTime(rec, 'body');
    const evidence = rec['evidence_requirement_ref'];
    return {
      item_code: requireCode(rec['item_code'], `/items/${i}/item_code`),
      evidence_requirement_ref:
        evidence === undefined || evidence === null
          ? null
          : requireUuid(evidence, `/items/${i}/evidence_requirement_ref`),
      required: rec['required'] === undefined ? true : rec['required'] === true,
    };
  });
}

function parseEvidence(raw: unknown, pointer: string): EvidenceLinkInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 32) bad(pointer, 'EVIDENCE_INVALID');
  return raw.map((item, i) => {
    const rec = asRecord(item);
    return {
      evidence_ref: requireUuid(rec['evidence_ref'], `${pointer}/${i}/evidence_ref`),
      kind_code: requireCode(rec['kind_code'], `${pointer}/${i}/kind_code`),
    };
  });
}

export function validateOpenInput(body: unknown): OpenInput {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  const allowed = [
    'application_id',
    'reason_code',
    'notice_code',
    'instruction_ref',
    'sla_pause_reason_code',
    'sla_stage_code',
    'response_due_at',
    'case_expected_state',
    'case_expected_version',
    'items',
    'evidence',
  ];
  for (const key of Object.keys(rec)) if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  const version = rec['case_expected_version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    bad('/case_expected_version', 'VERSION_REQUIRED');
  }
  if (typeof rec['case_expected_state'] !== 'string' || rec['case_expected_state'].length < 1) {
    bad('/case_expected_state', 'STATE_REQUIRED');
  }
  return {
    application_id: requireUuid(rec['application_id'], '/application_id'),
    reason_code: requireCode(rec['reason_code'], '/reason_code'),
    notice_code: requireCode(rec['notice_code'], '/notice_code'),
    instruction_ref: requireRef(rec['instruction_ref'], '/instruction_ref'),
    sla_pause_reason_code:
      rec['sla_pause_reason_code'] === undefined
        ? 'DEFICIENCY_OPEN'
        : requireCode(rec['sla_pause_reason_code'], '/sla_pause_reason_code'),
    sla_stage_code:
      rec['sla_stage_code'] === undefined
        ? 'OVERALL'
        : requireCode(rec['sla_stage_code'], '/sla_stage_code'),
    response_due_at: optionalDue(rec['response_due_at']),
    case_expected_state: rec['case_expected_state'] as string,
    case_expected_version: version,
    items: parseItems(rec['items']),
    evidence: parseEvidence(rec['evidence'], '/evidence'),
  };
}

export function validateRespondInput(body: unknown): RespondInput {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  const allowed = [
    'narrative_ref',
    'provided_item_codes',
    'evidence',
    'case_expected_state',
    'case_expected_version',
  ];
  for (const key of Object.keys(rec)) if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  const version = rec['case_expected_version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    bad('/case_expected_version', 'VERSION_REQUIRED');
  }
  if (typeof rec['case_expected_state'] !== 'string' || rec['case_expected_state'].length < 1) {
    bad('/case_expected_state', 'STATE_REQUIRED');
  }
  const codes = rec['provided_item_codes'];
  if (!Array.isArray(codes) || codes.length < 1) bad('/provided_item_codes', 'ITEMS_REQUIRED');
  return {
    narrative_ref: requireRef(rec['narrative_ref'], '/narrative_ref'),
    provided_item_codes: codes.map((c, i) => requireCode(c, `/provided_item_codes/${i}`)),
    evidence: parseEvidence(rec['evidence'], '/evidence'),
    case_expected_state: rec['case_expected_state'] as string,
    case_expected_version: version,
  };
}

export function validateCloseInput(body: unknown): CloseInput {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  for (const key of Object.keys(rec)) if (key !== 'close_reason_code') bad(`/${key}`, 'UNKNOWN_FIELD');
  return { close_reason_code: requireCode(rec['close_reason_code'], '/close_reason_code') };
}

export function validateEmptyInput(body: unknown): void {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  if (Object.keys(rec).length > 0) bad(`/${Object.keys(rec)[0] as string}`, 'UNKNOWN_FIELD');
}
