import { createHash } from 'node:crypto';
import type { FormPackage, TemplateVersion } from './types';

/** Same canonical form as CMP-009 `sha256Of`: keys sorted recursively, then JSON. */
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

export function formContentHash(form: FormPackage): string {
  return `sha256:${createHash('sha256').update(canonicalJson(form), 'utf8').digest('hex')}`;
}

/** Fail closed when a version's recorded hash does not match its form (mutated metadata). */
export function assertVersionIntegrity(version: TemplateVersion): void {
  if (formContentHash(version.form) !== version.content_hash) {
    throw new Error(`Template version ${version.version_id} content hash mismatch`);
  }
}
