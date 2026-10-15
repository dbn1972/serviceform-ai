import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Validates payloads against the FROZEN contracts/m09 schemas (read-only; never mutated). */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(join(root, 'packages/contracts/package.json'));
const { Ajv2020 } = require('ajv/dist/2020.js') as {
  Ajv2020: new (opts: object) => {
    addSchema(s: object): void;
    getSchema(id: string): ((v: unknown) => boolean) & { errors?: unknown };
  };
};
const formats = require('ajv-formats') as { default?: (a: unknown) => void } & ((a: unknown) => void);
const addFormats = formats.default ?? formats;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const dir of ['contracts/shared/schemas', 'contracts/m09/schemas']) {
  for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(root, dir, f), 'utf8')) as object);
  }
}

const IDS: Record<string, string> = {};
for (const f of readdirSync(join(root, 'contracts/m09/schemas'))) {
  const s = JSON.parse(readFileSync(join(root, 'contracts/m09/schemas', f), 'utf8')) as {
    $id: string;
  };
  IDS[f.replace('.schema.json', '')] = s.$id;
}

export function validateM09(
  name: string,
  value: unknown,
): { valid: boolean; errors: unknown } {
  const id = IDS[name];
  if (!id) throw new Error(`unknown m09 schema ${name}`);
  const fn = ajv.getSchema(id);
  const valid = fn(value);
  return { valid, errors: fn.errors ?? null };
}
