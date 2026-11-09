// SF-M10-B-INT: derives a second synthetic SAMPLE_LAB tenant ("tenant B") from fixtures/lab/platform.
// Output directory layout matches SF_PLATFORM_LAB_DIR. Synthetic identifiers only; LOCAL/CI only.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SRC = join(ROOT, 'fixtures/lab/platform');
const out = process.argv[2];
if (!out) {
  console.error('usage: tenant-b.mjs <out-dir>');
  process.exit(2);
}

const TENANT_B = {
  tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000b1',
  tsb_id: '0d15ba00-0002-4000-8000-0d15ba0000b2',
  service_id: '0d15ba00-0003-4000-8000-0d15ba0000b3',
  officer_id: '0d15ba00-0f01-4000-8000-0d15ba000fb1',
  officer_subject: 'sample-lab-case-officer-b1',
  portal_id: 'sample-lab-citizen-b',
};

const read = (f) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));

const placement = read('placement.citizen.json');
const tenantA = placement.tenant_id;
placement.portal_id = TENANT_B.portal_id;
placement.tenant_id = TENANT_B.tenant_id;
placement.offerings = [{ catalogue_id: 'IND-SOC-002', tenant_service_binding_id: TENANT_B.tsb_id }];

const published = read('published-bindings.json');
const a = published.bindings.find((b) => b.tenant_id === tenantA);
// The form pin stays on the PUBLISHED catalogue version (the host refuses any other); every other
// pin, including the workflow version (…b012), is tenant B's own.
const pins = Object.fromEntries(
  Object.entries(a.pins).map(([k, v]) => [
    k,
    k === 'tenant_service_binding_id'
      ? TENANT_B.tsb_id
      : k === 'form_version_id'
        ? v
        : `${v.slice(0, -4)}b${v.slice(-3)}`,
  ]),
);
const bindingB = {
  ...a,
  tenant_id: TENANT_B.tenant_id,
  tenant_service_binding_id: TENANT_B.tsb_id,
  service_id: TENANT_B.service_id,
  pins,
};

const officers = {
  _note: 'SF-M10-B-INT synthetic tenant B officer (SIMULATED IdP).',
  simulation: 'SIMULATED',
  officers: [
    {
      officer_id: TENANT_B.officer_id,
      subject: TENANT_B.officer_subject,
      display_name: 'SAMPLE LAB Case Officer B',
      tenant_id: TENANT_B.tenant_id,
      roles: ['SAMPLE_LAB_CASE_OFFICER'],
    },
  ],
};

// Both tenants are present in tenant B's OPA data so isolation cannot come from missing policy data.
const opaTenants = read('opa/sf/tenants/data.json');
opaTenants[TENANT_B.tenant_id] = structuredClone(opaTenants[tenantA]);

mkdirSync(join(out, 'opa/sf/tenants'), { recursive: true });
writeFileSync(join(out, 'placement.citizen.json'), `${JSON.stringify(placement, null, 2)}\n`);
writeFileSync(
  join(out, 'published-bindings.json'),
  `${JSON.stringify({ ...published, bindings: [bindingB] }, null, 2)}\n`,
);
writeFileSync(join(out, 'officers.json'), `${JSON.stringify(officers, null, 2)}\n`);
writeFileSync(join(out, 'opa/sf/tenants/data.json'), `${JSON.stringify(opaTenants, null, 2)}\n`);
// Same SAMPLE_LAB canonical graph; tenant B pins its own published version id (…b012).
writeFileSync(join(out, 'workflow.json'), `${JSON.stringify(read('workflow.json'), null, 2)}\n`);
process.stdout.write(`tenant-b: fixtures written (tenant ${TENANT_B.tenant_id})\n`);
