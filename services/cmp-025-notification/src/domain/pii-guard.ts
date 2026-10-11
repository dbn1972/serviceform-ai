import { isParamName } from './model.js';

export type PiiKind = 'EMAIL' | 'PHONE_OR_ID_NUMBER' | 'TAX_ID' | 'CONTROL_CHARS' | 'TOO_LONG';

export const MAX_PARAM_VALUE_LENGTH = 200;
export const MAX_PARAMS = 32;

// A digit run (with common separators) of >= 10 digits that is not glued to letters or hyphens:
// phone numbers, Aadhaar-style 12 digit numbers and similar. Hyphen-prefixed reference numbers
// such as APP-2026-000123 are therefore not misread as a phone number.
const NUMERIC_RUN = /(?<![A-Za-z0-9-])\+?\d[\d\s().-]{8,}\d(?![A-Za-z0-9])/g;
const TAX_ID = /\b[A-Z]{5}\d{4}[A-Z]\b/;
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

function digitCount(text: string): number {
  let n = 0;
  for (const ch of text) if (ch >= '0' && ch <= '9') n += 1;
  return n;
}

/** Deterministic PII screen for template parameter values (INT-013, Constitution: no PII in payloads). */
export function findPii(value: string): PiiKind | null {
  if (value.length > MAX_PARAM_VALUE_LENGTH) return 'TOO_LONG';
  if (hasControlChars(value)) return 'CONTROL_CHARS';
  if (value.includes('@')) return 'EMAIL';
  if (TAX_ID.test(value)) return 'TAX_ID';
  for (const match of value.matchAll(NUMERIC_RUN)) {
    if (digitCount(match[0]) >= 10) return 'PHONE_OR_ID_NUMBER';
  }
  return null;
}

const PII_PARAM_NAME =
  /(phone|mobile|msisdn|e?mail|aadhaar|aadhar|passport|address|dob|birth|(^|_)pan(_|$))/i;

export function looksLikePiiParamName(name: string): boolean {
  return PII_PARAM_NAME.test(name) || !isParamName(name);
}

/** Returns the first offending parameter name, or null when the whole map is PII-free. */
export function firstPiiParam(params: Readonly<Record<string, string>>): string | null {
  for (const [name, value] of Object.entries(params)) {
    if (findPii(value) !== null) return name;
  }
  return null;
}
