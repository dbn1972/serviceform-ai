/**
 * Contract validation gate: every schema compiles in strict mode, every example under
 * examples/valid passes and every example under examples/invalid fails.
 * Example file names start with the contract name, e.g. `event-envelope.camel-case.json`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACTS_DIR } from '../src/paths.js';
import { SCHEMAS } from '../src/schemas.js';
import { CONTRACTS, type ContractName, createAjv, validate } from '../src/validators.js';

const root = join(CONTRACTS_DIR, 'examples');
let failures = 0;

createAjv(); // strict compile of every schema
const schemaFiles = readdirSync(join(CONTRACTS_DIR, 'schemas')).filter((f) =>
  f.endsWith('.schema.json'),
);
if (schemaFiles.length !== SCHEMAS.length) {
  failures++;
  console.log(
    `FAIL ${schemaFiles.length} schema files but ${SCHEMAS.length} registered in src/schemas.ts`,
  );
}
const names = Object.keys(CONTRACTS) as ContractName[];

function contractOf(file: string): ContractName {
  const match = names
    .filter((n) => file === `${n}.json` || file.startsWith(`${n}.`))
    .sort((a, b) => b.length - a.length)[0];
  if (!match) throw new Error(`Example ${file} does not name a known contract`);
  return match;
}

const covered = new Set<ContractName>();
for (const kind of ['valid', 'invalid'] as const) {
  for (const file of readdirSync(join(root, kind))
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const name = contractOf(file);
    const value: unknown = JSON.parse(readFileSync(join(root, kind, file), 'utf8'));
    const { valid, errors } = validate(name, value);
    const ok = kind === 'valid' ? valid : !valid;
    if (kind === 'valid') covered.add(name);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${kind}/${file} -> ${name}`);
    if (!ok) {
      failures++;
      if (kind === 'valid') console.log(JSON.stringify(errors, null, 2));
    }
  }
}
for (const n of names) {
  if (!covered.has(n)) {
    failures++;
    console.log(`FAIL no valid example for contract ${n}`);
  }
}
console.log(`\n${names.length} contracts, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
