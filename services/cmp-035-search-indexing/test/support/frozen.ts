import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHARED = join(REPO_ROOT, 'contracts/shared/schemas');
export const M08 = join(REPO_ROOT, 'contracts/m08');

interface AjvLike {
  addSchema(schema: object): AjvLike;
  getSchema(id: string): (((data: unknown) => boolean) & { errors?: unknown[] | null }) | undefined;
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

let ajv: AjvLike | null = null;

function instance(): AjvLike {
  if (ajv) return ajv;
  const a = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(a);
  for (const f of readdirSync(SHARED).filter((n) => n.endsWith('.schema.json'))) {
    a.addSchema(readJson(join(SHARED, f)));
  }
  a.addSchema(readJson(join(M08, 'schemas/search-document.schema.json')));
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

export const IDS = {
  searchDocument: 'https://contracts.serviceform.ai/m08/search-document/v1',
  envelope: 'https://contracts.serviceform.ai/event-envelope/v1',
  audit: 'https://contracts.serviceform.ai/audit-event/v1',
  requestContext: 'https://contracts.serviceform.ai/request-context/v1',
  errorResponse: 'https://contracts.serviceform.ai/error-response/v1',
  authzInput: 'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
  isolation: 'https://contracts.serviceform.ai/isolation-declaration/v1',
} as const;
