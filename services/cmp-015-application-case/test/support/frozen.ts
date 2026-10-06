import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the FROZEN JSON Schemas (read-only) and compiles them with the Ajv that
 * @serviceform/contracts already depends on, resolved from that package so this service keeps a
 * dependency-free manifest (same approach as evidence/SF-M05-CG-001/validate-m05-schemas.mjs).
 */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHARED = join(REPO_ROOT, 'contracts/shared/schemas');
const M05 = join(REPO_ROOT, 'contracts/m05/schemas');

interface AjvLike {
  addSchema(schema: object): AjvLike;
  getSchema(id: string): (((data: unknown) => boolean) & { errors?: unknown[] | null }) | undefined;
  compile(schema: object): ((data: unknown) => boolean) & { errors?: unknown[] | null };
}

const loadFromContracts = createRequire(join(REPO_ROOT, 'packages/contracts/package.json'));
const { Ajv2020 } = loadFromContracts('ajv/dist/2020.js') as {
  Ajv2020: new (opts: object) => AjvLike;
};
const formatsModule = loadFromContracts('ajv-formats') as
  ((ajv: AjvLike) => void) | { default: (ajv: AjvLike) => void };
const addFormats = typeof formatsModule === 'function' ? formatsModule : formatsModule.default;

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export function sharedSchema(name: string): Record<string, unknown> {
  return readJson(join(SHARED, `${name}.schema.json`));
}

export function m05Schema(name: string): Record<string, unknown> {
  return readJson(join(M05, `${name}.schema.json`));
}

export function m05Example(kind: 'valid' | 'invalid', file: string): Record<string, unknown> {
  return readJson(join(REPO_ROOT, 'contracts/m05/examples', kind, file));
}

export function m05Examples(kind: 'valid' | 'invalid'): string[] {
  return readdirSync(join(REPO_ROOT, 'contracts/m05/examples', kind)).filter((f) =>
    f.endsWith('.json'),
  );
}

let ajv: AjvLike | null = null;

function instance(): AjvLike {
  if (ajv) return ajv;
  const a = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(a);
  for (const f of readdirSync(SHARED).filter((n) => n.endsWith('.schema.json'))) {
    a.addSchema(readJson(join(SHARED, f)));
  }
  for (const name of [
    'version-pinning',
    'application-case-sm',
    'workflow-model',
    'human-task',
    'sla-clock',
    'command-transition',
  ]) {
    a.addSchema(m05Schema(name));
  }
  ajv = a;
  return a;
}

export function validator(id: string): (data: unknown) => { valid: boolean; errors: unknown } {
  const fn = instance().getSchema(id);
  if (!fn) throw new Error(`schema ${id} not registered`);
  return (data: unknown) => {
    const valid = fn(data);
    return { valid, errors: fn.errors ?? null };
  };
}

export function compileSchema(
  schema: Record<string, unknown>,
): (data: unknown) => { valid: boolean; errors: unknown } {
  const a = instance();
  const id = schema['$id'];
  const fn = (typeof id === 'string' ? a.getSchema(id) : undefined) ?? a.compile(schema);
  return (data: unknown) => {
    const valid = fn(data);
    return { valid, errors: fn.errors ?? null };
  };
}

export const IDS = {
  caseSm: 'https://contracts.serviceform.ai/m05/application-case-sm/v1',
  commandTransition: 'https://contracts.serviceform.ai/m05/command-transition/v1',
  versionPinning: 'https://contracts.serviceform.ai/m05/version-pinning/v1',
  envelope: 'https://contracts.serviceform.ai/event-envelope/v1',
  audit: 'https://contracts.serviceform.ai/audit-event/v1',
  requestContext: 'https://contracts.serviceform.ai/request-context/v1',
  errorResponse: 'https://contracts.serviceform.ai/error-response/v1',
  authzInput: 'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
  authzOutput: 'https://contracts.serviceform.ai/authz-decision/v1#/$defs/output',
  idempotency: 'https://contracts.serviceform.ai/idempotency-record/v1',
} as const;
