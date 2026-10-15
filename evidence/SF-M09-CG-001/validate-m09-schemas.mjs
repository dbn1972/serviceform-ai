/**
 * Validate FROZEN_CANDIDATE M09 schemas without mutating packages/contracts.
 * Usage: node evidence/SF-M09-CG-001/validate-m09-schemas.mjs
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

const m09 = join(root, 'contracts', 'm09');
const shared = join(root, 'contracts', 'shared', 'schemas');
const logDir = join(here, 'logs');
mkdirSync(logDir, { recursive: true });

const lines = [];
function log(s) {
  lines.push(s);
  console.log(s);
}

let failures = 0;
function check(ok, pass, fail) {
  if (ok) log(`PASS ${pass}`);
  else {
    failures++;
    log(`FAIL ${fail ?? pass}`);
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateSchema: true });
addFormats(ajv);

for (const f of readdirSync(shared).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(shared, f), 'utf8')));
}

const schemas = readdirSync(join(m09, 'schemas'))
  .filter((n) => n.endsWith('.schema.json'))
  .sort()
  .map((f) => ({ file: f, schema: JSON.parse(readFileSync(join(m09, 'schemas', f), 'utf8')) }));

const ids = schemas.map((s) => s.schema.$id);
check(new Set(ids).size === ids.length, `unique $id count=${ids.length}`, 'duplicate $id among M09 schemas');
const contractIds = schemas.map((s) => s.schema.properties?.contract_id?.const);
check(new Set(contractIds).size === contractIds.length, `unique contract_id ${contractIds.join(',')}`, 'duplicate contract_id const');

function collectRefs(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string') acc.push(node.$ref);
  for (const v of Object.values(node)) collectRefs(v, acc);
}
const m09Ids = new Set(ids);
const adj = new Map(ids.map((id) => [id, []]));
let externalRefFail = 0;
for (const s of schemas) {
  const refs = [];
  collectRefs(s.schema, refs);
  for (const r of refs) {
    const base = r.split('#')[0];
    if (base === '') continue;
    if (m09Ids.has(base)) {
      if (base !== s.schema.$id) adj.get(s.schema.$id).push(base);
    } else if (base !== 'https://contracts.serviceform.ai/common/v1') {
      externalRefFail++;
      log(`FAIL ${s.file} references non-allowlisted schema ${base}`);
    }
  }
}
if (externalRefFail) failures += externalRefFail;
else log('PASS refs limited to common/v1 and M09 siblings');

const state = new Map();
let cyc = 0;
function visit(n, stack) {
  if (state.get(n) === 1) {
    cyc++;
    log(`FAIL circular $ref ${[...stack, n].join(' -> ')}`);
    return;
  }
  if (state.get(n) === 2) return;
  state.set(n, 1);
  for (const d of adj.get(n) || []) visit(d, [...stack, n]);
  state.set(n, 2);
}
for (const id of ids) visit(id, []);
failures += cyc;
if (!cyc) log('PASS no circular M09 $ref');

for (const s of schemas) ajv.addSchema(s.schema);
for (const s of schemas) {
  try {
    ajv.getSchema(s.schema.$id);
    log(`PASS compile ${s.file} $id=${s.schema.$id}`);
  } catch (e) {
    failures++;
    log(`FAIL compile ${s.file}: ${e.message}`);
  }
}

const CONTRACTS = {
  appointment: 'https://contracts.serviceform.ai/m09/appointment/v1',
  'assisted-session': 'https://contracts.serviceform.ai/m09/assistedsession/v1',
  'semantic-element': 'https://contracts.serviceform.ai/m09/semanticelement/v1',
  'migration-project': 'https://contracts.serviceform.ai/m09/migrationproject/v1',
  'risk-assessment': 'https://contracts.serviceform.ai/m09/riskassessment/v1',
  'privacy-request': 'https://contracts.serviceform.ai/m09/privacyrequest/v1',
  'sfpackage-manifest': 'https://contracts.serviceform.ai/m09/sfpackagemanifest/v1',
  'bpmn-profile-report': 'https://contracts.serviceform.ai/m09/bpmnprofilereport/v1',
};
function contractOf(file) {
  const names = Object.keys(CONTRACTS).sort((a, b) => b.length - a.length);
  const match = names.find((n) => file === `${n}.json` || file.startsWith(`${n}.`));
  if (!match) throw new Error(`Example ${file} does not name a known M09 contract`);
  return match;
}

const coveredValid = new Set();
const coveredInvalid = new Set();
for (const kind of ['valid', 'invalid']) {
  const dir = join(m09, 'examples', kind);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const name = contractOf(file);
    const value = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const fn = ajv.getSchema(CONTRACTS[name]);
    const ok = fn(value);
    const expectValid = kind === 'valid';
    const pass = expectValid ? ok : !ok;
    (expectValid ? coveredValid : coveredInvalid).add(name);
    log(`${pass ? 'PASS' : 'FAIL'} ${kind}/${file} -> ${name}`);
    if (!pass) {
      failures++;
      if (expectValid) log(JSON.stringify(fn.errors, null, 2));
    }
  }
}
for (const n of Object.keys(CONTRACTS)) {
  check(coveredValid.has(n), `valid example present for ${n}`);
  check(coveredInvalid.has(n), `invalid example present for ${n}`);
}

const byName = (n) => schemas.find((x) => x.file === `${n}.schema.json`)?.schema;
const p = (n) => byName(n)?.properties ?? {};

check(p('appointment').capacity_atomic?.const === true, 'appointment.capacity_atomic const true');
check(p('appointment').notification_failure_invalidates_booking?.const === false, 'appointment notification failure does not invalidate booking');
check(p('assisted-session').applied_by_distinct_from_applied_for?.const === true, 'assisted-session applied_by distinct from applied_for');
check(p('risk-assessment').authoritative_decision_by_this_component?.const === false, 'risk-assessment non-authoritative');
check(p('migration-project').dry_run_required_before_execute?.const === true, 'migration-project dry_run required');
check(p('privacy-request').cross_component_direct_mutation_forbidden?.const === true, 'privacy-request no cross-component mutation');
check(p('privacy-request').owner_task_orchestration_only?.const === true, 'privacy-request orchestration only');
check(p('sfpackage-manifest').embedded_secrets_forbidden?.const === true, 'sfpackage-manifest no embedded secrets');
check(p('bpmn-profile-report').temporal_remains_runtime?.const === true, 'bpmn-profile temporal remains runtime');
check(p('bpmn-profile-report').canonical_model?.const === 'ServiceForm Workflow Model', 'bpmn-profile canonical model');

for (const s of schemas) {
  check(s.schema.properties?.contract_status?.const === 'FROZEN', `${s.file} contract_status const FROZEN`);
  check(s.schema.properties?.freeze_status?.const === 'FROZEN', `${s.file} freeze_status const FROZEN`);
  check(s.schema.properties?.invented_statutory_policy_forbidden?.const === true, `${s.file} invented_statutory_policy_forbidden`);
  check(s.schema.properties?.tenant_id?.$ref === 'https://contracts.serviceform.ai/common/v1#/$defs/uuid', `${s.file} tenant_id common uuid`);
  check(s.schema.additionalProperties === false, `${s.file} closed (additionalProperties false)`);
}

log(`\n${Object.keys(CONTRACTS).length} M09 contracts, ${failures} failure(s)`);
writeFileSync(join(logDir, 'schema-validate.log'), lines.join('\n') + '\n');
process.exit(failures === 0 ? 0 : 1);
