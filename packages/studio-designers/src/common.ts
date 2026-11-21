/**
 * Shared Studio metadata-kind designer helpers (Fee / SLA / Evidence / Credential).
 * Structural keys match CMP-033; authoring is Studio-only and not part of the pin hash.
 */

import { SEMVER_RE } from './forms/model';
import { contentHash } from './hash';

export const DOC_KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
export const ITEM_ID_RE = /^[a-z][a-z0-9._-]{1,127}$/;
export { SEMVER_RE };

export const ISO_DURATION_RE = /^P[0-9TYMWDHS]{1,31}$/;

export type MetaIssueSeverity = 'error' | 'warning';

export interface MetaIssue {
  code: string;
  severity: MetaIssueSeverity;
  message: string;
  /** Row/item id when the issue is about a list entry; otherwise the pack. */
  targetId?: string;
}

export function hasErrors(issues: readonly MetaIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

let counter = 0;

export function newId(prefix: string): string {
  counter += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${(uuid ?? counter.toString(36)).replace(/-/g, '').slice(0, 10)}`;
}

export function moveById<T extends { id: string }>(
  list: readonly T[],
  id: string,
  delta: number,
): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return [...list];
  const next = [...list];
  const [row] = next.splice(i, 1);
  if (!row) return [...list];
  next.splice(Math.max(0, Math.min(next.length, i + delta)), 0, row);
  return next;
}

/** Canonical pin hash of the executable (structural) payload keys only. */
export function pinHash(executable: unknown): Promise<string> {
  return contentHash(executable);
}

export function documentKeyOf(packKey: string, version: string): string {
  return `${packKey}.v${version}`;
}
