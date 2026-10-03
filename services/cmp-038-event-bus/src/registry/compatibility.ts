import type { Compatibility } from '@serviceform/outbox';
import { RegistryError } from '@serviceform/outbox';

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
}

function asSchema(value: unknown): JsonSchema {
  return value && typeof value === 'object' ? (value as JsonSchema) : {};
}

function typesOf(s: JsonSchema): Set<string> {
  if (Array.isArray(s.type)) return new Set(s.type);
  if (typeof s.type === 'string') return new Set([s.type]);
  return new Set();
}

function extraRequired(prev: JsonSchema, next: JsonSchema): string[] {
  const was = new Set(prev.required ?? []);
  return (next.required ?? []).filter((k) => !was.has(k));
}

function removedProperties(prev: JsonSchema, next: JsonSchema): string[] {
  const nextProps = next.properties ?? {};
  return Object.keys(prev.properties ?? {}).filter((k) => !(k in nextProps));
}

function typeChanges(prev: JsonSchema, next: JsonSchema): string[] {
  const out: string[] = [];
  const prevProps = prev.properties ?? {};
  const nextProps = next.properties ?? {};
  for (const key of Object.keys(prevProps)) {
    if (!(key in nextProps)) continue;
    const prevProp = prevProps[key];
    const nextProp = nextProps[key];
    if (!prevProp || !nextProp) continue;
    const a = typesOf(prevProp);
    const b = typesOf(nextProp);
    if (a.size && b.size && [...a].some((t) => !b.has(t))) out.push(key);
  }
  return out;
}

function enumNarrowed(prev: JsonSchema, next: JsonSchema): boolean {
  const prevProps = prev.properties ?? {};
  const nextProps = next.properties ?? {};
  for (const key of Object.keys(prevProps)) {
    const pe = prevProps[key]?.enum;
    const ne = nextProps[key]?.enum;
    if (!pe || !ne) continue;
    if (pe.some((v) => !ne.includes(v))) return true;
  }
  return false;
}

function additionalTightened(prev: JsonSchema, next: JsonSchema): boolean {
  return prev.additionalProperties !== false && next.additionalProperties === false;
}

/** BACKWARD: consumers of the new schema can read data written with the old schema. */
export function checkCompatibility(
  previous: unknown,
  next: unknown,
  mode: Compatibility,
): { ok: true } | { ok: false; reason: string } {
  const prev = asSchema(previous);
  const nxt = asSchema(next);
  const backwardProblems: string[] = [];
  if (extraRequired(prev, nxt).length) backwardProblems.push('new required properties');
  if (removedProperties(prev, nxt).length) backwardProblems.push('removed properties');
  if (typeChanges(prev, nxt).length) backwardProblems.push('type changes');
  if (enumNarrowed(prev, nxt)) backwardProblems.push('enum narrowing');
  if (additionalTightened(prev, nxt)) backwardProblems.push('additionalProperties true->false');

  const forwardProblems: string[] = [];
  if (extraRequired(nxt, prev).length) forwardProblems.push('removed required properties');
  if (removedProperties(nxt, prev).length)
    forwardProblems.push('added properties without optional');
  if (typeChanges(nxt, prev).length) forwardProblems.push('type changes');

  if (mode === 'BACKWARD' || mode === 'FULL') {
    if (backwardProblems.length) return { ok: false, reason: backwardProblems.join(',') };
  }
  if (mode === 'FORWARD' || mode === 'FULL') {
    if (forwardProblems.length) return { ok: false, reason: forwardProblems.join(',') };
  }
  return { ok: true };
}

export function assertCompatible(
  previous: unknown | undefined,
  next: unknown,
  mode: Compatibility,
  nextVersion: number,
  maxVersion: number,
): void {
  if (nextVersion !== maxVersion + 1) {
    throw new RegistryError('SF-SYS-003', {
      details: [{ code: 'SCHEMA_INCOMPATIBLE', message: 'schema_version must be max+1' }],
    });
  }
  if (!previous) return;
  const result = checkCompatibility(previous, next, mode);
  if (!result.ok) {
    throw new RegistryError('SF-SYS-003', {
      details: [{ code: 'SCHEMA_INCOMPATIBLE', message: result.reason }],
    });
  }
}
