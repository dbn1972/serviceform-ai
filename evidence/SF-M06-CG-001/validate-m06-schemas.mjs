/**
 * Validate FROZEN M06 schemas without mutating packages/contracts.
 * Usage: node evidence/SF-M06-CG-001/validate-m06-schemas.mjs
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const require = createRequire(join(root, 'packages/contracts/package.json'));
const Ajv2020 = require('ajv/dist/2020.js').Ajv2020;
const addFormatsModule = require('ajv-formats');
const addFormats = addFormatsModule.default ?? addFormatsModule;

const m06 = join(root, 'contracts', 'm06');
const shared = join(root, 'contracts', 'shared', 'schemas');
const logDir = join(here, 'logs');
mkdirSync(logDir, { recursive: true });

const lines = [];
function log(s) {
  lines.push(s);
  console.log(s);
}

let failures = 0;

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateSchema: true });
addFormats(ajv);

for (const f of readdirSync(shared).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(shared, f), 'utf8')));
}

const schemaFiles = readdirSync(join(m06, 'schemas'))
  .filter((n) => n.endsWith('.schema.json'))
  .sort();
const schemas = schemaFiles.map((f) => ({
  file: f,
  schema: JSON.parse(readFileSync(join(m06, 'schemas', f), 'utf8')),
}));
schemas.sort((a, b) => {
  const pref = {
    'version-pinning.schema.json': 0,
    'application-case-sm.schema.json': 1,
    'workflow-model.schema.json': 1,
    'human-task.schema.json': 1,
    'sla-clock.schema.json': 1,
    'command-transition.schema.json': 2,
  };
  return (pref[a.file] ?? 1) - (pref[b.file] ?? 1);
});

const ids = schemas.map((s) => s.schema.$id);
if (new Set(ids).size !== ids.length) {
  failures++;
  log('FAIL duplicate $id among M06 schemas');
} else {
  log(`PASS unique $id count=${ids.length}`);
}

const contractIds = schemas.map((s) => {
  const c = s.schema.properties?.contract_id?.const;
  return c;
});
if (new Set(contractIds).size !== contractIds.length) {
  failures++;
  log('FAIL duplicate contract_id const');
} else {
  log(`PASS unique contract_id ${contractIds.join(',')}`);
}

function collectRefs(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string') acc.push(node.$ref);
  for (const v of Object.values(node)) collectRefs(v, acc);
}

const m06Ids = new Set(ids);
const adj = new Map(ids.map((id) => [id, []]));
for (const s of schemas) {
  const refs = [];
  collectRefs(s.schema, refs);
  for (const r of refs) {
    const base = r.split('#')[0];
    if (m06Ids.has(base) && base !== s.schema.$id) adj.get(s.schema.$id).push(base);
  }
}
const state = new Map();
function visit(n, stack) {
  if (state.get(n) === 1) {
    failures++;
    log(`FAIL circular $ref ${[...stack, n].join(' -> ')}`);
    return;
  }
  if (state.get(n) === 2) return;
  state.set(n, 1);
  for (const d of adj.get(n) || []) visit(d, [...stack, n]);
  state.set(n, 2);
}
for (const id of ids) visit(id, []);
if (failures === 0) log('PASS no circular M06 $ref');

for (const s of schemas) {
  try {
    ajv.addSchema(s.schema);
    log(`PASS compile ${s.file} $id=${s.schema.$id}`);
  } catch (e) {
    failures++;
    log(`FAIL compile ${s.file}: ${e.message}`);
  }
}

const CONTRACTS = {
  "fee-quote": "https://contracts.serviceform.ai/m06/fee-quote/v1",
  "payment-intent": "https://contracts.serviceform.ai/m06/payment-intent/v1",
  "payment-callback": "https://contracts.serviceform.ai/m06/payment-callback/v1",
  "notification-dispatch": "https://contracts.serviceform.ai/m06/notification-dispatch/v1",
  "message-thread": "https://contracts.serviceform.ai/m06/message-thread/v1"
};

function contractOf(file) {
  const names = Object.keys(CONTRACTS).sort((a, b) => b.length - a.length);
  const match = names.find((n) => file === `${n}.json` || file.startsWith(`${n}.`));
  if (!match) throw new Error(`Example ${file} does not name a known M06 contract`);
  return match;
}

const covered = new Set();
for (const kind of ['valid', 'invalid']) {
  const dir = join(m06, 'examples', kind);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const name = contractOf(file);
    const value = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const fn = ajv.getSchema(CONTRACTS[name]);
    if (!fn) {
      failures++;
      log(`FAIL no compiled schema for ${name}`);
      continue;
    }
    const okInstance = fn(value);
    const expectValid = kind === 'valid';
    const pass = expectValid ? okInstance : !okInstance;
    if (kind === 'valid') covered.add(name);
    log(`${pass ? 'PASS' : 'FAIL'} ${kind}/${file} -> ${name}`);
    if (!pass) {
      failures++;
      if (expectValid) log(JSON.stringify(fn.errors, null, 2));
    }
  }
}
for (const n of Object.keys(CONTRACTS)) {
  if (!covered.has(n)) {
    failures++;
    log(`FAIL no valid example for ${n}`);
  }
}

function propertyKeys(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (node.properties && typeof node.properties === 'object') {
    for (const k of Object.keys(node.properties)) acc.push(k);
  }
  for (const v of Object.values(node)) propertyKeys(v, acc);
}


const requiredMarkers = [
  ['fee-quote', 'client_authoritative_amount'],
  ['payment-intent', 'amount_locked_from_fee_quote'],
  ['payment-callback', 'duplicate_financial_effect_forbidden'],
  ['notification-dispatch', 'raw_pii_in_payload_forbidden'],
  ['message-thread', 'cross_tenant_participants_forbidden'],
];
for (const [name, marker] of requiredMarkers) {
  const s = schemas.find((x) => x.file.startsWith(name));
  if (!s || !JSON.stringify(s.schema).includes(marker)) {
    failures++;
    log(`FAIL ${name} missing invariant marker ${marker}`);
  } else {
    log(`PASS ${name} has ${marker}`);
  }
}
const fee = schemas.find((x) => x.file.startsWith('fee-quote'));
const amtEnum = fee?.schema?.properties?.amount_source?.enum || [];
if (amtEnum.includes('CLIENT')) {
  failures++;
  log('FAIL fee-quote amount_source allows CLIENT');
} else {
  log('PASS fee-quote amount_source excludes CLIENT');
}
for (const s of schemas) {
  const text = JSON.stringify(s.schema);
  if (!text.includes('"const":"FROZEN"') && !text.includes('"const": "FROZEN"')) {
    failures++;
    log(`FAIL ${s.file} missing FROZEN const`);
  }
}

log(`\n${Object.keys(CONTRACTS).length} M06 contracts, ${failures} failure(s)`);
writeFileSync(join(logDir, 'schema-validate.log'), lines.join('\n') + '\n');
process.exit(failures === 0 ? 0 : 1);
