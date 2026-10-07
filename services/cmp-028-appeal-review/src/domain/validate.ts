import { Cmp028Error, detail } from '../errors.js';

function isHex(c: number): boolean {
  const isDigit = c >= 48 && c <= 57;
  const isLower = c >= 97 && c <= 102;
  return isDigit || isLower;
}

/** Linear UUID check — avoids njsscan regex_dos on user-supplied values. */
export function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  const parts = value.split('-');
  if (parts.length !== 5) return false;
  const lengths = [8, 4, 4, 4, 12] as const;
  for (let i = 0; i < 5; i += 1) {
    const part = parts[i];
    if (!part || part.length !== lengths[i]) return false;
    for (let j = 0; j < part.length; j += 1) {
      const c = part.charCodeAt(j);
      if (!isHex(c)) return false;
    }
  }
  const version = parts[2]?.charCodeAt(0);
  if (version === undefined || version < 49 || version > 56) return false; // 1-8
  const variant = parts[3]?.charCodeAt(0);
  if (variant !== 56 && variant !== 57 && variant !== 97 && variant !== 98) return false; // 8-9 a-b
  return true;
}

/** Linear role/grounds code: A-Z then 1–63 of A-Z0-9_. */
export function isCode(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  const first = value.charCodeAt(0);
  if (first < 65 || first > 90) return false;
  for (let i = 1; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isUpper = c >= 65 && c <= 90;
    if (!isDigit && !isUpper && c !== 95) return false;
  }
  return true;
}

function isIdempotencyChar(c: number): boolean {
  const isDigit = c >= 48 && c <= 57;
  const isUpper = c >= 65 && c <= 90;
  const isLower = c >= 97 && c <= 122;
  return isDigit || isUpper || isLower || c === 95 || c === 46 || c === 58 || c === 45;
}

export function isIdempotencyKey(value: string): boolean {
  if (value.length < 8 || value.length > 128) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isIdempotencyChar(value.charCodeAt(i))) return false;
  }
  return true;
}

function isContentRefChar(c: number): boolean {
  return isIdempotencyChar(c) || c === 47;
}

export function isContentRef(value: string): boolean {
  if (value.length < 8 || value.length > 200) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isContentRefChar(value.charCodeAt(i))) return false;
  }
  return true;
}

export function invalid(pointer: string, code = 'INVALID_FIELD'): Cmp028Error {
  return new Cmp028Error('SF-SYS-003', detail(code, pointer));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, pointer: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(pointer, 'OBJECT_REQUIRED');
  return value;
}

export function assertOnlyKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  pointer: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw invalid(`${pointer}/${key}`, 'UNKNOWN_FIELD');
    }
  }
}

export function uuidField(obj: Record<string, unknown>, key: string, pointer: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !isUuid(v)) throw invalid(`${pointer}/${key}`);
  return v;
}

export function optionalUuid(
  obj: Record<string, unknown>,
  key: string,
  pointer: string,
): string | null {
  const v = obj[key];
  if (v === undefined) return null;
  if (typeof v !== 'string' || !isUuid(v)) throw invalid(`${pointer}/${key}`);
  return v;
}

export function codeField(obj: Record<string, unknown>, key: string, pointer: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !isCode(v)) throw invalid(`${pointer}/${key}`);
  return v;
}

export function optionalCode(
  obj: Record<string, unknown>,
  key: string,
  pointer: string,
): string | null {
  const v = obj[key];
  if (v === undefined) return null;
  if (typeof v !== 'string' || !isCode(v)) throw invalid(`${pointer}/${key}`);
  return v;
}

export function uuidList(obj: Record<string, unknown>, key: string, pointer: string): string[] {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 32) throw invalid(`${pointer}/${key}`);
  const out: string[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const item = v[i];
    if (typeof item !== 'string' || !isUuid(item)) throw invalid(`${pointer}/${key}/${i}`);
    out.push(item);
  }
  return out;
}
