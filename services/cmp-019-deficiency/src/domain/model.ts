export const STATUSES = ['OPEN', 'RESPONSE_RECEIVED', 'CLOSED'] as const;
export type DeficiencyStatus = (typeof STATUSES)[number];

export const OPERATIONS = ['OPEN', 'RESPOND', 'CLOSE'] as const;
export type DeficiencyOperation = (typeof OPERATIONS)[number];

export const ITEM_STATUSES = ['REQUESTED', 'PROVIDED'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const REF_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
export const DEFAULT_PAUSE_REASON = 'DEFICIENCY_OPEN';
export const DEFAULT_STAGE = 'OVERALL';

export interface RequestedItemInput {
  item_code: string;
  evidence_requirement_ref: string | null;
  required: boolean;
}

export interface EvidenceLinkInput {
  evidence_ref: string;
  kind_code: string;
}

export function nextStatus(
  from: DeficiencyStatus,
  operation: Exclude<DeficiencyOperation, 'OPEN'>,
): DeficiencyStatus | null {
  if (operation === 'RESPOND' && from === 'OPEN') return 'RESPONSE_RECEIVED';
  if (operation === 'CLOSE' && (from === 'OPEN' || from === 'RESPONSE_RECEIVED')) return 'CLOSED';
  return null;
}

export function isCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_RE.test(value);
}

export function isRef(value: unknown): value is string {
  return typeof value === 'string' && REF_RE.test(value);
}
