import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const entries = new Map<string, unknown>();
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v !== undefined) entries.set(key, sortKeys(v));
    }
    return Object.fromEntries(entries);
  }
  return value;
}

export function sha256Of(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function sha256Fingerprint(parts: readonly string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isPolicyKey(value: string): boolean {
  return KEY_RE.test(value);
}
