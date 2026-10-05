import { Cmp017Error, detail } from '../errors.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const NODE_ID = /^[A-Z][A-Z0-9_]{0,63}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

export function invalid(pointer: string, code = 'INVALID_FIELD'): Cmp017Error {
  return new Cmp017Error('SF-SYS-003', detail(code, pointer));
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
  if (typeof v !== 'string' || !UUID.test(v)) throw invalid(`${pointer}/${key}`);
  return v;
}

export function optionalUuid(
  obj: Record<string, unknown>,
  key: string,
  pointer: string,
): string | null {
  const v = obj[key];
  if (v === undefined) return null;
  if (typeof v !== 'string' || !UUID.test(v)) throw invalid(`${pointer}/${key}`);
  return v;
}

export function codeField(obj: Record<string, unknown>, key: string, pointer: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !CODE.test(v)) throw invalid(`${pointer}/${key}`);
  return v;
}
