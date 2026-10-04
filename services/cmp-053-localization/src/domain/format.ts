import { Cmp053Error } from '../errors.js';

export interface FormatProfileInput {
  date_skeleton: string;
  time_skeleton: string;
  decimal_separator: string;
  group_separator: string;
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

export function isDecimalString(raw: string): boolean {
  if (raw.length === 0 || raw.length > 40) return false;
  let i = 0;
  if (raw.charCodeAt(0) === 45) i = 1;
  if (i >= raw.length) return false;
  let sawDot = false;
  let digits = 0;
  for (; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    if (c === 46) {
      if (sawDot) return false;
      sawDot = true;
      continue;
    }
    if (!isDigit(c)) return false;
    digits += 1;
  }
  return digits > 0;
}

function groupWhole(whole: string, sep: string): string {
  if (whole.length <= 3) return whole;
  const parts: string[] = [];
  let rest = whole;
  while (rest.length > 3) {
    parts.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  parts.unshift(rest);
  return parts.join(sep);
}

/** Applies stored separators. Does not infer a locale or currency policy. */
export function formatDecimal(profile: FormatProfileInput, raw: string): string {
  if (!isDecimalString(raw)) {
    throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'INVALID_NUMBER' }] });
  }
  const negative = raw.startsWith('-');
  const abs = negative ? raw.slice(1) : raw;
  const dot = abs.indexOf('.');
  const whole = dot === -1 ? abs : abs.slice(0, dot);
  const frac = dot === -1 ? undefined : abs.slice(dot + 1);
  const grouped = groupWhole(whole.length === 0 ? '0' : whole, profile.group_separator);
  const body = frac !== undefined ? `${grouped}${profile.decimal_separator}${frac}` : grouped;
  return negative ? `-${body}` : body;
}

function isoParts(isoDate: string): { year: string; month: string; day: string } | null {
  if (isoDate.length !== 10) return null;
  if (isoDate.charCodeAt(4) !== 45 || isoDate.charCodeAt(7) !== 45) return null;
  const year = isoDate.slice(0, 4);
  const month = isoDate.slice(5, 7);
  const day = isoDate.slice(8, 10);
  for (const part of [year, month, day]) {
    for (let i = 0; i < part.length; i += 1) {
      if (!isDigit(part.charCodeAt(i))) return null;
    }
  }
  return { year, month, day };
}

/** Token-replaces a stored date skeleton from an ISO calendar date. Fail-closed on parse. */
export function formatIsoDate(profile: FormatProfileInput, isoDate: string): string {
  const parts = isoParts(isoDate);
  if (!parts) throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'INVALID_DATE' }] });
  return profile.date_skeleton
    .replaceAll('yyyy', parts.year)
    .replaceAll('MM', parts.month)
    .replaceAll('dd', parts.day);
}
