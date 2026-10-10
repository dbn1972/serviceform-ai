import { isValidReasonCode } from './guard.js';

export interface ParsedItem {
  alias: string;
  reason_codes: string[];
}

export type ParseResult =
  { ok: true; items: ParsedItem[] } | { ok: false; code: 'UNSAFE_OUTPUT' | 'MALFORMED_OUTPUT' };

const ITEM_KEYS = ['candidate', 'reason_codes'];
const TOP_KEYS = ['items', 'advisory_only', 'statutory_decision'];
const MAX_REASONS_PER_ITEM = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strictly parses the CMP-039 advisory output. Anything outside the closed shape is refused:
 * unknown keys, free text, invented candidates, reason codes outside the pinned policy list,
 * or any assertion that the output is authoritative.
 */
export function parseGatewayOutput(
  output: string,
  params: {
    aliases: readonly string[];
    allowedReasonCodes: readonly string[];
    maxResults: number;
  },
): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    return { ok: false, code: 'MALFORMED_OUTPUT' };
  }
  if (!isRecord(raw)) return { ok: false, code: 'MALFORMED_OUTPUT' };
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) return { ok: false, code: 'UNSAFE_OUTPUT' };
  }
  if (raw['advisory_only'] !== undefined && raw['advisory_only'] !== true) {
    return { ok: false, code: 'UNSAFE_OUTPUT' };
  }
  if (raw['statutory_decision'] !== undefined && raw['statutory_decision'] !== false) {
    return { ok: false, code: 'UNSAFE_OUTPUT' };
  }
  const list = raw['items'];
  if (!Array.isArray(list) || list.length < 1) return { ok: false, code: 'MALFORMED_OUTPUT' };
  if (list.length > params.maxResults) return { ok: false, code: 'UNSAFE_OUTPUT' };

  const seen = new Set<string>();
  const items: ParsedItem[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) return { ok: false, code: 'MALFORMED_OUTPUT' };
    for (const key of Object.keys(entry)) {
      if (!ITEM_KEYS.includes(key)) return { ok: false, code: 'UNSAFE_OUTPUT' };
    }
    const alias = entry['candidate'];
    const reasons = entry['reason_codes'];
    if (typeof alias !== 'string' || !params.aliases.includes(alias) || seen.has(alias)) {
      return { ok: false, code: 'UNSAFE_OUTPUT' };
    }
    if (
      !Array.isArray(reasons) ||
      reasons.length < 1 ||
      reasons.length > MAX_REASONS_PER_ITEM ||
      new Set(reasons).size !== reasons.length
    ) {
      return { ok: false, code: 'MALFORMED_OUTPUT' };
    }
    for (const code of reasons) {
      if (
        typeof code !== 'string' ||
        !params.allowedReasonCodes.includes(code) ||
        !isValidReasonCode(code)
      ) {
        return { ok: false, code: 'UNSAFE_OUTPUT' };
      }
    }
    seen.add(alias);
    items.push({ alias, reason_codes: reasons as string[] });
  }
  return { ok: true, items };
}
