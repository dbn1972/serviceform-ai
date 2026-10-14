/**
 * Validate FROZEN_CANDIDATE M07 schemas without mutating packages/contracts.
 * Usage: node evidence/SF-M07-CG-001/validate-m07-schemas.mjs
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

const m07 = join(root, 'contracts', 'm07');
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

const schemas = readdirSync(join(m07, 'schemas'))
  .filter((n) => n.endsWith('.schema.json'))
  .sort()
  .map((f) => ({ file: f, schema: JSON.parse(readFileSync(join(m07, 'schemas', f), 'utf8')) }));

const ids = schemas.map((s) => s.schema.$id);
check(new Set(ids).size === ids.length, `unique $id count=${ids.length}`, 'duplicate $id among M07 schemas');
const contractIds = schemas.map((s) => s.schema.properties?.contract_id?.const);
check(new Set(contractIds).size === contractIds.length, `unique contract_id ${contractIds.join(',')}`, 'duplicate contract_id const');

function collectRefs(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string') acc.push(node.$ref);
  for (const v of Object.values(node)) collectRefs(v, acc);
}
const m07Ids = new Set(ids);
const adj = new Map(ids.map((id) => [id, []]));
let externalRefFail = 0;
for (const s of schemas) {
  const refs = [];
  collectRefs(s.schema, refs);
  for (const r of refs) {
    const base = r.split('#')[0];
    if (base === '') continue;
    if (m07Ids.has(base)) {
      if (base !== s.schema.$id) adj.get(s.schema.$id).push(base);
    } else if (
      base !== 'https://contracts.serviceform.ai/common/v1' &&
      base !== 'https://contracts.serviceform.ai/simulation-marker/v1'
    ) {
      externalRefFail++;
      log(`FAIL ${s.file} references non-allowlisted schema ${base}`);
    }
  }
}
if (externalRefFail) failures += externalRefFail;
else log('PASS refs limited to common/v1, simulation-marker/v1 and M07 siblings');

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
if (!cyc) log('PASS no circular M07 $ref');

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
  credential: 'https://contracts.serviceform.ai/m07/credential/v1',
  'signing-record': 'https://contracts.serviceform.ai/m07/signing-record/v1',
  'credential-status': 'https://contracts.serviceform.ai/m07/credential-status/v1',
  'verification-token': 'https://contracts.serviceform.ai/m07/verification-token/v1',
  'digilocker-publish': 'https://contracts.serviceform.ai/m07/digilocker-publish/v1',
};
function contractOf(file) {
  const names = Object.keys(CONTRACTS).sort((a, b) => b.length - a.length);
  const match = names.find((n) => file === `${n}.json` || file.startsWith(`${n}.`));
  if (!match) throw new Error(`Example ${file} does not name a known M07 contract`);
  return match;
}

const coveredValid = new Set();
const coveredInvalid = new Set();
for (const kind of ['valid', 'invalid']) {
  const dir = join(m07, 'examples', kind);
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

check(p('credential').approval_decision_by_this_component?.const === false, 'credential.approval_decision_by_this_component const false');
check(p('credential').registry_status_owner_cmp?.const === 'CMP-024', 'credential.registry_status_owner_cmp const CMP-024');
check(p('credential').issuance_reversible_by_publish_failure?.const === false, 'credential issuance not reversible by publish failure');
check(p('credential').issuance_reversible_by_notification_failure?.const === false, 'credential issuance not reversible by notification failure');
check(
  JSON.stringify(p('credential').lifecycle_status?.enum) === JSON.stringify(['GENERATED', 'SIGNED', 'ISSUED']),
  'credential lifecycle enum GENERATED/SIGNED/ISSUED',
);

for (const n of ['signing-record', 'digilocker-publish']) {
  check(p(n).integration_contract?.const === 'INT-013', `${n}.integration_contract const INT-013`);
  check(
    JSON.stringify(p(n).connector_mode?.enum) === JSON.stringify(['REAL', 'SANDBOX', 'SIMULATED']),
    `${n}.connector_mode REAL|SANDBOX|SIMULATED`,
  );
  check(
    p(n).simulation_marker?.$ref === 'https://contracts.serviceform.ai/simulation-marker/v1',
    `${n}.simulation_marker refs frozen SF-CON-SIMULATION-MARKER`,
  );
  check(JSON.stringify(byName(n).allOf).includes('"simulation_marker"'), `${n} conditionally requires simulation_marker when SIMULATED`);
}
check(p('signing-record').retry_safe?.const === true, 'signing-record.retry_safe const true');

check(p('credential-status').status_authority_cmp?.const === 'CMP-024', 'credential-status.status_authority_cmp const CMP-024');
check(p('credential-status').history_append_only?.const === true, 'credential-status.history_append_only const true');
check(
  JSON.stringify(byName('credential-status').$defs?.registryStatus?.enum) ===
    JSON.stringify(['REGISTERED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REISSUED']),
  'credential-status enum REGISTERED/ACTIVE/SUSPENDED/REVOKED/REISSUED',
);

check(p('verification-token').status_source_cmp?.const === 'CMP-024', 'verification-token.status_source_cmp const CMP-024');
check(p('verification-token').registry_status_read_only?.const === true, 'verification-token registry status read-only');
check(p('verification-token').status_write_forbidden?.const === true, 'verification-token status_write_forbidden');
check(p('verification-token').embedded_pii_forbidden?.const === true, 'verification-token embedded_pii_forbidden');
check(p('verification-token').public_view?.additionalProperties === false, 'verification-token public_view closed');

check(p('digilocker-publish').issuance_reversed_on_publish_failure?.const === false, 'digilocker-publish never reverses issuance');
check(p('digilocker-publish').registry_status_changed_by_publish?.const === false, 'digilocker-publish never changes registry status');
check(p('digilocker-publish').credential_lifecycle_status_at_request?.const === 'ISSUED', 'digilocker-publish only for ISSUED credentials');
for (const k of ['consent_ref', 'purpose_code', 'idempotency_key']) {
  check(byName('digilocker-publish').required.includes(k), `digilocker-publish requires ${k}`);
}

for (const s of schemas) {
  check(s.schema.properties?.contract_status?.const === 'FROZEN', `${s.file} contract_status const FROZEN`);
  check(s.schema.properties?.freeze_status?.const === 'FROZEN', `${s.file} freeze_status const FROZEN`);
  check(s.schema.properties?.tenant_id?.$ref === 'https://contracts.serviceform.ai/common/v1#/$defs/uuid', `${s.file} tenant_id common uuid`);
  check(s.schema.additionalProperties === false, `${s.file} closed (additionalProperties false)`);
}

log(`\n${Object.keys(CONTRACTS).length} M07 contracts, ${failures} failure(s)`);
writeFileSync(join(logDir, 'schema-validate.log'), lines.join('\n') + '\n');
process.exit(failures === 0 ? 0 : 1);
