import { createHash } from 'node:crypto';

export const METADATA_KINDS = [
  'SERVICE',
  'OFFERING',
  'FORM',
  'RULES',
  'EVIDENCE',
  'FEE',
  'WORKFLOW',
  'SLA',
  'ACCESS',
  'CREDENTIAL',
  'NOTIFICATION',
] as const;

export type MetadataKind = (typeof METADATA_KINDS)[number];

export function isMetadataKind(value: string): value is MetadataKind {
  return (METADATA_KINDS as readonly string[]).includes(value);
}

export function schemaIdForKind(kind: MetadataKind): string {
  return `sf.metadata.kind.${kind.toLowerCase()}.v1`;
}

export function sha256Fingerprint(parts: readonly string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

export function payloadHash(payload: unknown): string {
  return sha256Fingerprint([JSON.stringify(payload)]);
}

const KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ISO_DURATION = /^P[0-9TYMWDHS]{1,31}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(pointer: string, message: string): never {
  throw Object.assign(new Error(message), { pointer });
}

function requireString(obj: Record<string, unknown>, key: string, pointer: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) fail(pointer, `${key} required`);
  return v;
}

function requireArray(obj: Record<string, unknown>, key: string, pointer: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v) || v.length < 1) fail(pointer, `${key} required`);
  return v;
}

/** Structural kind schemas only. No named-service or statutory content. */
export function validateKindPayload(kind: MetadataKind, payload: unknown): void {
  if (!isRecord(payload)) fail('/payload', 'payload must be an object');
  switch (kind) {
    case 'SERVICE': {
      const code = requireString(payload, 'code', '/payload/code');
      if (!CODE_RE.test(code)) fail('/payload/code', 'invalid code');
      requireString(payload, 'title', '/payload/title');
      return;
    }
    case 'OFFERING': {
      const sid = requireString(payload, 'service_document_key', '/payload/service_document_key');
      if (!KEY_RE.test(sid)) fail('/payload/service_document_key', 'invalid key');
      const scope = requireString(payload, 'jurisdiction_scope', '/payload/jurisdiction_scope');
      if (scope !== 'PLATFORM' && scope !== 'TENANT')
        fail('/payload/jurisdiction_scope', 'invalid scope');
      return;
    }
    case 'FORM': {
      const pages = requireArray(payload, 'pages', '/payload/pages');
      for (const [i, page] of pages.entries()) {
        if (!isRecord(page)) fail(`/payload/pages/${i}`, 'page must be object');
        if (!KEY_RE.test(requireString(page, 'id', `/payload/pages/${i}/id`))) {
          fail(`/payload/pages/${i}/id`, 'invalid id');
        }
        const fields = requireArray(page, 'fields', `/payload/pages/${i}/fields`);
        for (const [j, field] of fields.entries()) {
          if (!isRecord(field)) fail(`/payload/pages/${i}/fields/${j}`, 'field must be object');
          if (!KEY_RE.test(requireString(field, 'id', `/payload/pages/${i}/fields/${j}/id`))) {
            fail(`/payload/pages/${i}/fields/${j}/id`, 'invalid id');
          }
          requireString(field, 'control', `/payload/pages/${i}/fields/${j}/control`);
        }
      }
      return;
    }
    case 'RULES': {
      if (!KEY_RE.test(requireString(payload, 'rule_pack_id', '/payload/rule_pack_id'))) {
        fail('/payload/rule_pack_id', 'invalid id');
      }
      const engine = requireString(payload, 'engine', '/payload/engine');
      if (engine !== 'GORULES') fail('/payload/engine', 'unsupported engine');
      return;
    }
    case 'EVIDENCE': {
      const reqs = requireArray(payload, 'requirements', '/payload/requirements');
      for (const [i, req] of reqs.entries()) {
        if (!isRecord(req)) fail(`/payload/requirements/${i}`, 'requirement must be object');
        if (!KEY_RE.test(requireString(req, 'id', `/payload/requirements/${i}/id`))) {
          fail(`/payload/requirements/${i}/id`, 'invalid id');
        }
        requireString(req, 'artifact_type', `/payload/requirements/${i}/artifact_type`);
      }
      return;
    }
    case 'FEE': {
      const items = requireArray(payload, 'items', '/payload/items');
      for (const [i, item] of items.entries()) {
        if (!isRecord(item)) fail(`/payload/items/${i}`, 'item must be object');
        if (!KEY_RE.test(requireString(item, 'id', `/payload/items/${i}/id`))) {
          fail(`/payload/items/${i}/id`, 'invalid id');
        }
        const amount = item['amount_minor'];
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
          fail(`/payload/items/${i}/amount_minor`, 'invalid amount');
        }
      }
      return;
    }
    case 'WORKFLOW': {
      const steps = requireArray(payload, 'steps', '/payload/steps');
      for (const [i, step] of steps.entries()) {
        if (!isRecord(step)) fail(`/payload/steps/${i}`, 'step must be object');
        if (!KEY_RE.test(requireString(step, 'id', `/payload/steps/${i}/id`))) {
          fail(`/payload/steps/${i}/id`, 'invalid id');
        }
        requireString(step, 'type', `/payload/steps/${i}/type`);
      }
      return;
    }
    case 'SLA': {
      const clocks = requireArray(payload, 'clocks', '/payload/clocks');
      for (const [i, clock] of clocks.entries()) {
        if (!isRecord(clock)) fail(`/payload/clocks/${i}`, 'clock must be object');
        if (!KEY_RE.test(requireString(clock, 'id', `/payload/clocks/${i}/id`))) {
          fail(`/payload/clocks/${i}/id`, 'invalid id');
        }
        const dur = requireString(clock, 'duration_iso', `/payload/clocks/${i}/duration_iso`);
        if (!ISO_DURATION.test(dur)) fail(`/payload/clocks/${i}/duration_iso`, 'invalid duration');
      }
      return;
    }
    case 'ACCESS': {
      const roles = requireArray(payload, 'roles', '/payload/roles');
      for (const [i, role] of roles.entries()) {
        if (typeof role !== 'string' || !ROLE_RE.test(role)) {
          fail(`/payload/roles/${i}`, 'invalid role code');
        }
      }
      return;
    }
    case 'CREDENTIAL': {
      if (!KEY_RE.test(requireString(payload, 'template_key', '/payload/template_key'))) {
        fail('/payload/template_key', 'invalid key');
      }
      return;
    }
    case 'NOTIFICATION': {
      const templates = requireArray(payload, 'templates', '/payload/templates');
      for (const [i, tpl] of templates.entries()) {
        if (!isRecord(tpl)) fail(`/payload/templates/${i}`, 'template must be object');
        if (!KEY_RE.test(requireString(tpl, 'id', `/payload/templates/${i}/id`))) {
          fail(`/payload/templates/${i}/id`, 'invalid id');
        }
        const channel = requireString(tpl, 'channel', `/payload/templates/${i}/channel`);
        if (channel !== 'EMAIL' && channel !== 'SMS')
          fail(`/payload/templates/${i}/channel`, 'invalid channel');
      }
      return;
    }
    default: {
      const _never: never = kind;
      fail('/kind', String(_never));
    }
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isDocumentKey(value: string): boolean {
  return KEY_RE.test(value);
}

export function createFingerprint(body: {
  kind: string;
  document_key: string;
  schema_id: string;
  payload: unknown;
}): string {
  return sha256Fingerprint([
    'POST /metadata/documents',
    body.kind,
    body.document_key,
    body.schema_id,
    JSON.stringify(body.payload),
  ]);
}

export function patchFingerprint(id: string, payload: unknown): string {
  return sha256Fingerprint(['PATCH /metadata/documents/{id}', id, JSON.stringify(payload)]);
}

export function validateFingerprint(id: string): string {
  return sha256Fingerprint(['POST /metadata/documents/{id}/validate', id]);
}

export function publishFingerprint(id: string): string {
  return sha256Fingerprint(['POST /metadata/documents/{id}/publish', id]);
}

export function composeFingerprint(body: { bundle_key: string; document_ids: string[] }): string {
  return sha256Fingerprint([
    'POST /metadata/bundles',
    body.bundle_key,
    [...body.document_ids].sort().join(','),
  ]);
}
