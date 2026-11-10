/**
 * Content addressing shared by every Studio designer. Same canonical form as CMP-009 `sha256Of`
 * and `@serviceform/service-templates/integrity`: object keys sorted recursively, then JSON.
 * Uses Web Crypto so it runs in the browser and in Node without `node:crypto`.
 */

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

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SF-SYS-004: Web Crypto unavailable');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `sha256:<hex>` digest of the canonical JSON form. */
export async function contentHash(value: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(value))}`;
}

export const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;

export function shortHash(hash: string): string {
  return hash.length > 24 ? `${hash.slice(0, 15)}…${hash.slice(-6)}` : hash;
}
