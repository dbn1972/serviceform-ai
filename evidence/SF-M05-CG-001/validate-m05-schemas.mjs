/**
 * Validate PROPOSED M05 schemas without mutating packages/contracts or the frozen lock.
 * Usage: node evidence/SF-M05-CG-001/validate-m05-schemas.mjs
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

const m05 = join(root, 'contracts', 'm05');
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

const schemaFiles = readdirSync(join(m05, 'schemas'))
  .filter((n) => n.endsWith('.schema.json'))
  .sort();
const schemas = schemaFiles.map((f) => ({
  file: f,
  schema: JSON.parse(readFileSync(join(m05, 'schemas', f), 'utf8')),
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
  log('FAIL duplicate $id among M05 schemas');
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

const m05Ids = new Set(ids);
const adj = new Map(ids.map((id) => [id, []]));
for (const s of schemas) {
  const refs = [];
  collectRefs(s.schema, refs);
  for (const r of refs) {
    const base = r.split('#')[0];
    if (m05Ids.has(base) && base !== s.schema.$id) adj.get(s.schema.$id).push(base);
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
if (failures === 0) log('PASS no circular M05 $ref');

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
  'application-case-sm': 'https://contracts.serviceform.ai/m05/application-case-sm/v1',
  'workflow-model': 'https://contracts.serviceform.ai/m05/workflow-model/v1',
  'command-transition': 'https://contracts.serviceform.ai/m05/command-transition/v1',
  'human-task': 'https://contracts.serviceform.ai/m05/human-task/v1',
  'sla-clock': 'https://contracts.serviceform.ai/m05/sla-clock/v1',
  'version-pinning': 'https://contracts.serviceform.ai/m05/version-pinning/v1',
};

function contractOf(file) {
  const names = Object.keys(CONTRACTS).sort((a, b) => b.length - a.length);
  const match = names.find((n) => file === `${n}.json` || file.startsWith(`${n}.`));
  if (!match) throw new Error(`Example ${file} does not name a known M05 contract`);
  return match;
}

const covered = new Set();
for (const kind of ['valid', 'invalid']) {
  const dir = join(m05, 'examples', kind);
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

const forbiddenProps = [
  'officer_name',
  'named_officer',
  'employee_name',
  'officer_id_hardcoded',
];
for (const s of schemas) {
  const keys = [];
  propertyKeys(s.schema, keys);
  const hit = keys.filter((k) => forbiddenProps.includes(k));
  if (hit.length) {
    failures++;
    log(`FAIL named-officer property in ${s.file}: ${hit.join(',')}`);
  }
}
log('PASS schema property keys have no named-officer fields');

const blob = schemas.map((s) => JSON.stringify(s.schema)).join('\n');
const bait = [
  'BPMN_ENGINE',
  'bpmn-runtime',
  'Temporal-authoritative-case',
  'named_officer',
  'officer_name',
];
for (const t of bait) {
  if (blob.includes(t)) {
    failures++;
    log(`FAIL schema text contains scanner token ${t}`);
  }
}
if (!blob.includes('IMPORT_EXPORT_PROFILE_ONLY')) {
  failures++;
  log('FAIL workflow schema missing BPMN import/export-only marker');
}

log(`\n${Object.keys(CONTRACTS).length} M05 contracts, ${failures} failure(s)`);
writeFileSync(join(logDir, 'schema-validate.log'), lines.join('\n') + '\n');
process.exit(failures === 0 ? 0 : 1);
