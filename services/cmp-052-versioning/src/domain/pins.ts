import { createHash } from 'node:crypto';
import { Cmp052Error } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;

export const PIN_KEYS = [
  'service',
  'offering',
  'form',
  'rules',
  'evidence',
  'fee',
  'workflow',
  'sla',
  'access',
  'credential',
  'notification',
  'authorization_policy',
] as const;

export type PinKey = (typeof PIN_KEYS)[number];

export interface PinRef {
  version_ref: string;
  content_hash: string;
}

export type PinMap = Record<PinKey, PinRef>;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isBindingKey(value: string): boolean {
  return KEY_RE.test(value);
}

export function sha256Fingerprint(parts: readonly string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePins(raw: unknown): PinMap {
  if (!isRecord(raw)) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'PINS_REQUIRED' }] });
  }
  const extra = Object.keys(raw).filter((k) => !(PIN_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'UNKNOWN_PIN_KEY' }] });
  }
  const pins = {} as PinMap;
  for (const key of PIN_KEYS) {
    const entry = raw[key];
    if (!isRecord(entry)) {
      throw new Cmp052Error('SF-SYS-003', {
        details: [{ code: 'PIN_MISSING', pointer: `/${key}` }],
      });
    }
    const versionRef = entry['version_ref'];
    const contentHash = entry['content_hash'];
    if (typeof versionRef !== 'string' || versionRef.length < 1 || versionRef.length > 200) {
      throw new Cmp052Error('SF-SYS-003', {
        details: [{ code: 'PIN_VERSION_REF', pointer: `/${key}/version_ref` }],
      });
    }
    if (typeof contentHash !== 'string' || !HASH_RE.test(contentHash)) {
      throw new Cmp052Error('SF-SYS-003', {
        details: [{ code: 'PIN_HASH', pointer: `/${key}/content_hash` }],
      });
    }
    pins[key] = { version_ref: versionRef, content_hash: contentHash };
  }
  return pins;
}

export function dependencyGraph(
  pins: PinMap,
): { kind: PinKey; version_ref: string; content_hash: string }[] {
  return PIN_KEYS.map((kind) => ({
    kind,
    version_ref: pins[kind].version_ref,
    content_hash: pins[kind].content_hash,
  }));
}

export function artifactHash(input: {
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  pins: PinMap;
}): string {
  const graph = dependencyGraph(input.pins)
    .map((n) => `${n.kind}:${n.version_ref}:${n.content_hash}`)
    .join(',');
  return sha256Fingerprint([
    input.binding_key,
    input.offering_ref,
    input.metadata_bundle_ref,
    graph,
  ]);
}

export function createBindingFingerprint(body: {
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  pins: unknown;
}): string {
  return sha256Fingerprint([
    'POST /tenant-service-bindings',
    body.binding_key,
    body.offering_ref,
    body.metadata_bundle_ref,
    JSON.stringify(body.pins),
  ]);
}

export function patchFingerprint(id: string, pins: unknown): string {
  return sha256Fingerprint(['PATCH /tenant-service-bindings/{id}', id, JSON.stringify(pins)]);
}

export function publishFingerprint(id: string): string {
  return sha256Fingerprint(['POST /tenant-service-bindings/{id}/publish', id]);
}
