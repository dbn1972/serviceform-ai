import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function sha256Of(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FORM_KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
export const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
export const PURPOSE_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const MESSAGE_KEY_RE = /^[a-z][a-z0-9._-]{0,198}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isLocaleTag(value: string): boolean {
  const parts = value.split('-');
  if (parts.length < 1 || parts.length > 5) return false;
  const lang = parts[0];
  if (!lang || lang.length < 2 || lang.length > 3) return false;
  if (![...lang].every((c) => c >= 'a' && c <= 'z')) return false;
  for (const sub of parts.slice(1)) {
    if (!sub || sub.length < 2 || sub.length > 8) return false;
    if (![...sub].every((c) => /[A-Za-z0-9]/.test(c))) return false;
  }
  return true;
}
