#!/usr/bin/env node
/**
 * Generate SAMPLE_LAB configurable authoring packs for Certificate catalogue stubs.
 * Fills SAMPLE_LAB DUMMY owner-config defaults (synthetic, not statute) + per-id overlays.
 * Tenants override via CMP-052 / tenant-overlay.schema.json. Fail-closed outside SAMPLE_LAB.
 * Skips Residence (PUBLISHED Odisha sample) and Income (hand-crafted M11 shell — updated separately).
 *
 * Usage: node scripts/catalogue/generate-certificate-packs.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const UNIVERSE = join(ROOT, 'packages/service-templates/src/catalogue/certificate-universe.json');
const SKELETON = join(ROOT, 'templates/certificate-pack-skeleton');
const OUT = join(ROOT, 'templates/certificate-packs');
const FIXTURES = join(ROOT, 'fixtures/catalogue/certificate-packs');
const DEFAULTS = join(OUT, 'sample-lab-dummy/defaults.json');

/** Hand-crafted packs that must not be overwritten by the factory. */
const SKIP_IDS = new Set([
  'IND-SOC-002', // Residence — templates/residence-certificate/
  'IND-SOC-031', // Income — templates/income-certificate/
]);

const HANDCRAFTED_PATHS = {
  'IND-SOC-002': 'templates/residence-certificate/',
  'IND-SOC-031': 'templates/income-certificate/',
};

const KEEP_DIRS = new Set(['sample-lab-dummy']);

const TMPL_FILES = [
  'service.yaml.tmpl',
  'fee-policy.yaml.tmpl',
  'sla-policy.yaml.tmpl',
  'evidence-policy.yaml.tmpl',
  'rules.gorules.yaml.tmpl',
  'workflow.yaml.tmpl',
  'access-policy.yaml.tmpl',
  'credential-template.yaml.tmpl',
  'notifications.yaml.tmpl',
  'SAMPLE_LAB_DUMMY.md.tmpl',
];

function slugifyCategory(category) {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function render(tmpl, vars) {
  return tmpl.replaceAll(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Missing template var ${key}`);
    return vars[key];
  });
}

function packDirName(catalogueId) {
  return catalogueId.toLowerCase();
}

function authoringPath(catalogueId) {
  if (HANDCRAFTED_PATHS[catalogueId]) return HANDCRAFTED_PATHS[catalogueId];
  return `templates/certificate-packs/${packDirName(catalogueId)}/`;
}

function ownerConfig(catalogueId, idUnderscore) {
  return {
    catalogue_id: catalogueId,
    defaults_ref: '../sample-lab-dummy/defaults.json',
    policy_kind: 'SAMPLE_LAB_DUMMY',
    not_for_production: true,
    not_statutory: true,
    certified: false,
    g6: false,
    self_certified: false,
    replace_before_non_lab_use: true,
    tenant_overlay_schema_ref: '../sample-lab-dummy/tenant-overlay.schema.json',
    credential: {
      credential_template_id: `SAMPLE_LAB_DUMMY_${idUnderscore}_V1`,
      digilocker_doc_type: `SAMPLE_LAB_DUMMY_${idUnderscore}`,
      digilocker_mode: 'SIMULATED',
    },
    notifications: {
      notification_pack_id: `${catalogueId.toLowerCase()}-notifications-sample-lab-dummy`,
      sms_dlt_pe_id: 'SAMPLE_LAB_DLT_PE_ID',
    },
    _comment:
      'Per-id SAMPLE_LAB DUMMY overlay on shared defaults. Tenants override via CMP-052 tenant-overlay. Not statute.',
  };
}

/** Minimal form shell: registry core fields as free-text/claims; no invented enums. */
function formSchema(entry, idLower) {
  const name = entry['Normalized National Definition'];
  const coreFields = entry['Recommended Core Fields'].split('; ');
  const issuer = new Set([
    'Application ID',
    'Issue Date',
    'Issuing Authority',
    'Digital Signature',
    'QR/Verification URI',
    'Status',
    'Jurisdiction',
  ]);
  const applicantCore = new Set(['Applicant Name', 'DOB/Entity Date', 'Address']);
  const properties = {
    applicant_name: {
      type: 'string',
      title: 'Full name (as per official record)',
      minLength: 1,
      maxLength: 120,
      semanticElementId: 'SF-SEM-PERSON-FULL-NAME',
    },
    applicant_dob: {
      type: 'string',
      format: 'date',
      title: 'Date of birth',
      semanticElementId: 'SF-SEM-PERSON-DOB',
    },
    applicant_gender: {
      type: 'string',
      title: 'Gender',
      enum: ['MALE', 'FEMALE', 'TRANSGENDER', 'OTHER', 'PREFER_NOT_TO_SAY'],
      semanticElementId: 'SF-SEM-PERSON-GENDER',
    },
    applicant_mobile: {
      type: 'string',
      title: 'Mobile number',
      pattern: '^[6-9][0-9]{9}$',
      semanticElementId: 'SF-SEM-PERSON-MOBILE',
    },
    applicant_address: {
      type: 'object',
      title: 'Address',
      additionalProperties: false,
      required: ['house_no_or_name', 'locality', 'district', 'state_code', 'pincode'],
      properties: {
        house_no_or_name: {
          type: 'string',
          title: 'House no. / name',
          minLength: 1,
          maxLength: 80,
        },
        locality: {
          type: 'string',
          title: 'Locality / village / ward',
          minLength: 1,
          maxLength: 80,
        },
        post_office: { type: 'string', title: 'Post office', maxLength: 80 },
        district: { type: 'string', title: 'District', minLength: 1, maxLength: 80 },
        state_code: { type: 'string', title: 'State / UT code', minLength: 2, maxLength: 2 },
        pincode: { type: 'string', title: 'PIN code', pattern: '^[1-9][0-9]{5}$' },
      },
    },
    purpose_of_certificate: {
      type: 'string',
      title: 'Purpose of certificate',
      minLength: 1,
      maxLength: 500,
      semanticElementId: 'SF-SEM-PURPOSE',
    },
    declaration_accepted: {
      type: 'boolean',
      title:
        'I declare that the particulars above are true for this SAMPLE_LAB preview and that no real personal data has been entered.',
      const: true,
    },
  };
  const required = [
    'applicant_name',
    'applicant_dob',
    'applicant_gender',
    'applicant_address',
    'purpose_of_certificate',
    'declaration_accepted',
  ];

  for (const field of coreFields) {
    if (issuer.has(field) || applicantCore.has(field)) continue;
    const key = `core_${field
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')}`;
    properties[key] = {
      type: 'string',
      title: field,
      maxLength: 200,
      semanticElementId: `SF-SEM-CORE-${field
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`,
      'x-ux4g': { hint: 'Registry core field · free text · SAMPLE_LAB DUMMY until owner policy' },
    };
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `serviceform://templates/certificate-packs/${idLower}/form.schema.json`,
    title: `${name} application`,
    description:
      'Aligned to registry Recommended Core Fields. SAMPLE_LAB DUMMY owner-config defaults fill fee/eligibility/evidence/SLA/jurisdiction slots (synthetic; tenant-overridable). Not statutory. CERTIFIED=false · G6=false.',
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function packReadme(entry, path) {
  return `# ${entry['Canonical Service ID']} — ${entry['Normalized National Definition']}

SAMPLE_LAB configurable authoring pack with **SAMPLE_LAB DUMMY** defaults (synthetic · not statute).

- Authoring path: \`${path}\`
- Dummy inventory: \`SAMPLE_LAB_DUMMY.md\`
- Shared defaults: \`../sample-lab-dummy/defaults.json\`
- Per-id overlay: \`owner-config.json\`
- Tenant / TSB overlay schema: \`../sample-lab-dummy/tenant-overlay.schema.json\`
- Owner JSON Schema: \`../owner-config.schema.json\`

Merge order: shared defaults → per-id owner-config → CMP-052 tenant overlay.
Fail-closed outside SAMPLE_LAB. Owner must replace before any non-lab use.
Citizen apply still requires a PUBLISHED TSB placement (Residence only today).
CERTIFIED=false · G6=false · self_certified=false.
`;
}

function writePack(entry, path, skeletons, defaults, manifest) {
  const catalogueId = entry['Canonical Service ID'];
  const idLower = packDirName(catalogueId);
  const idUnderscore = catalogueId.replaceAll('-', '_');
  const dir = join(OUT, idLower);
  mkdirSync(dir, { recursive: true });

  const vars = {
    CATALOGUE_ID: catalogueId,
    CATALOGUE_ID_UNDERSCORE: idUnderscore,
    ID_LOWER: idLower,
    NAME: entry['Normalized National Definition'],
    DEFINITION: entry.Definition,
    CATEGORY: entry.Category,
    CATEGORY_SLUG: slugifyCategory(entry.Category),
    OUTPUT_TYPE: entry['Service / Output Type'],
    ISSUING_AUTHORITY: entry['Typical Issuing Authority'],
    LIFECYCLE: entry['Lifecycle / Validity Class'],
    DIGILOCKER: entry['DigiLocker / Wallet Suitability'],
    AUTHORING_PATH: path,
  };

  for (const tmplName of TMPL_FILES) {
    const outName = tmplName.replace(/\.tmpl$/, '');
    writeFileSync(join(dir, outName), render(skeletons[tmplName], vars));
  }
  writeFileSync(
    join(dir, 'form.schema.json'),
    `${JSON.stringify(formSchema(entry, idLower), null, 2)}\n`,
  );
  writeFileSync(join(dir, 'README.md'), packReadme(entry, path));
  writeFileSync(
    join(dir, 'owner-config.json'),
    `${JSON.stringify(ownerConfig(catalogueId, idUnderscore), null, 2)}\n`,
  );

  writeFileSync(
    join(FIXTURES, `${idLower}.SAMPLE_LAB_DUMMY.md`),
    render(skeletons['SAMPLE_LAB_DUMMY.md.tmpl'], vars),
  );
  // Remove obsolete POLICY_INPUT_REQUIRED fixture if present.
  const obsolete = join(FIXTURES, `${idLower}.POLICY_INPUT_REQUIRED.md`);
  if (existsSync(obsolete)) rmSync(obsolete);

  const hash = createHash('sha256')
    .update(catalogueId)
    .update(entry['Normalized National Definition'])
    .update(JSON.stringify(defaults.fee))
    .digest('hex')
    .slice(0, 16);

  manifest.packs.push({
    catalogue_id: catalogueId,
    authoring_path: path,
    generator: 'certificate-pack-factory',
    status: 'SAMPLE_LAB_STUB',
    policy_kind: 'SAMPLE_LAB_DUMMY',
    content_fingerprint: hash,
  });
}

function main() {
  const universe = JSON.parse(readFileSync(UNIVERSE, 'utf8'));
  if (universe.filter.equals !== 'Certificate') {
    throw new Error('universe filter must be Certificate');
  }
  const defaults = JSON.parse(readFileSync(DEFAULTS, 'utf8'));
  if (defaults.policy_kind !== 'SAMPLE_LAB_DUMMY') {
    throw new Error('sample-lab-dummy/defaults.json must declare SAMPLE_LAB_DUMMY');
  }

  const skeletons = Object.fromEntries(
    TMPL_FILES.map((f) => [f, readFileSync(join(SKELETON, f), 'utf8')]),
  );

  // Remove previously generated pack dirs (keep README + schema + sample-lab-dummy + manifest).
  for (const name of readdirSync(OUT, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    if (name.name.startsWith('_')) continue;
    if (KEEP_DIRS.has(name.name)) continue;
    rmSync(join(OUT, name.name), { recursive: true, force: true });
  }

  mkdirSync(FIXTURES, { recursive: true });

  const manifest = {
    generated_at_note:
      'SAMPLE_LAB DUMMY factory output — synthetic defaults; tenant-overridable; not CERTIFIED; G6=false',
    catalogue_version: universe.catalogue_version,
    source: universe.source,
    filter: universe.filter,
    policy_kind: 'SAMPLE_LAB_DUMMY',
    defaults_ref: 'templates/certificate-packs/sample-lab-dummy/defaults.json',
    tenant_overlay_schema_ref:
      'templates/certificate-packs/sample-lab-dummy/tenant-overlay.schema.json',
    skipped_handcrafted: [...SKIP_IDS],
    packs: [],
  };

  let generated = 0;
  for (const entry of universe.entries) {
    const catalogueId = entry['Canonical Service ID'];
    const path = authoringPath(catalogueId);
    if (SKIP_IDS.has(catalogueId)) {
      manifest.packs.push({
        catalogue_id: catalogueId,
        authoring_path: path,
        generator: 'handcrafted',
        status: catalogueId === 'IND-SOC-002' ? 'PUBLISHED' : 'SAMPLE_LAB_STUB',
        policy_kind:
          catalogueId === 'IND-SOC-002' ? 'SAMPLE_LAB_ODISHA_PUBLIC_PORTAL' : 'SAMPLE_LAB_DUMMY',
      });
      continue;
    }

    writePack(entry, path, skeletons, defaults, manifest);
    generated += 1;
  }

  // Birth Registration is outside the Certificate filter but has a catalogue stub.
  const birthPath = 'templates/certificate-packs/ind-civ-001/';
  const birthDir = join(OUT, 'ind-civ-001');
  if (!existsSync(birthDir)) {
    const birthEntry = {
      'Canonical Service ID': 'IND-CIV-001',
      'Normalized National Definition': 'Birth Registration and Birth Certificate',
      Category: 'Civil Registration & Personal Identity',
      'Service / Output Type': 'Registration',
      Definition:
        'Registers a birth in the civil registration system and issues the official birth certificate containing the legally recorded event details.',
      'Typical Issuing Authority':
        'Registrar of Births & Deaths / Marriage Registrar / Revenue Authority',
      'Lifecycle / Validity Class': 'Long-lived / event-based',
      'Recommended Core Fields':
        'Applicant Name; DOB/Entity Date; Address; Jurisdiction; Application ID; Issue Date; Issuing Authority; Digital Signature; QR/Verification URI; Status; Event Date; Event Place; Registration Number',
      'DigiLocker / Wallet Suitability': 'Medium',
    };
    writePack(birthEntry, birthPath, skeletons, defaults, manifest);
    const last = manifest.packs[manifest.packs.length - 1];
    last.note = 'Registration exception outside Certificate filter';
    generated += 1;
  }

  manifest.generated_pack_count = generated;
  manifest.total_manifest_entries = manifest.packs.length;
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        generated,
        policy_kind: 'SAMPLE_LAB_DUMMY',
        skipped_handcrafted: [...SKIP_IDS],
        manifest_entries: manifest.packs.length,
        out: 'templates/certificate-packs/',
      },
      null,
      2,
    ),
  );
}

main();
