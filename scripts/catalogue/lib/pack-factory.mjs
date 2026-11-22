/**
 * Shared SAMPLE_LAB pack-factory helpers (Certificate + Licence + Permit).
 * Used by scripts/catalogue/generate-certificate-packs.mjs.
 * Synthetic SAMPLE_LAB DUMMY only — not statute. CERTIFIED=false · G6=false.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Hand-crafted packs that must not be overwritten by the factory. */
export const SKIP_IDS = new Set([
  'IND-SOC-002', // Residence — templates/residence-certificate/
  'IND-SOC-031', // Income — templates/income-certificate/
]);

export const HANDCRAFTED_PATHS = {
  'IND-SOC-002': 'templates/residence-certificate/',
  'IND-SOC-031': 'templates/income-certificate/',
};

export const KEEP_DIRS = new Set(['sample-lab-dummy']);

export const TMPL_FILES = [
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

export function slugifyCategory(category) {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export function render(tmpl, vars) {
  return tmpl.replaceAll(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Missing template var ${key}`);
    return vars[key];
  });
}

export function packDirName(catalogueId) {
  return catalogueId.toLowerCase();
}

export function authoringPath(catalogueId) {
  if (HANDCRAFTED_PATHS[catalogueId]) return HANDCRAFTED_PATHS[catalogueId];
  return `templates/certificate-packs/${packDirName(catalogueId)}/`;
}

export function ownerConfig(catalogueId, idUnderscore) {
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

/** Deterministic UUID (version 4 shape) from seed — stable across regenerations. */
export function deterministicUuid(seed) {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function stubFormVersionId(catalogueId) {
  return deterministicUuid(`sf-stub:${catalogueId}`);
}

/** Minimal form shell: registry core fields as free-text/claims; no invented enums. */
export function formSchema(entry, idLower) {
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
      required: [
        'house_no_or_name',
        'locality',
        'district',
        'municipality_code',
        'state_code',
        'pincode',
      ],
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
        district: {
          type: 'string',
          title: 'District (LGD code)',
          minLength: 2,
          maxLength: 64,
          pattern: '^[A-Z0-9][A-Z0-9._-]{1,63}$',
          semanticElementId: 'SF-SEM-ADDR-DISTRICT',
          'x-ux4g': { hint: 'Tenant-allowed district LGD codes (Admin → Bindings)' },
        },
        municipality_code: {
          type: 'string',
          title: 'Municipality / ULB (LGD local-body code)',
          minLength: 2,
          maxLength: 64,
          pattern: '^[A-Z0-9][A-Z0-9._-]{1,63}$',
          semanticElementId: 'SF-SEM-ADDR-MUNICIPALITY',
          'x-ux4g': {
            hint: 'Tenant-allowed municipality / ULB LGD codes (Admin → Bindings)',
          },
        },
        state_code: {
          type: 'string',
          title: 'State / UT (LGD code)',
          minLength: 2,
          maxLength: 64,
          pattern: '^[A-Z0-9][A-Z0-9._-]{1,63}$',
          semanticElementId: 'SF-SEM-ADDR-STATE-CODE',
          'x-ux4g': { hint: 'Tenant-allowed state LGD codes (Admin → Bindings)' },
        },
        pincode: { type: 'string', title: 'PIN code', pattern: '^[1-9][0-9]{5}$' },
      },
    },
    purpose_of_certificate: {
      type: 'string',
      title: 'Purpose of certificate / licence / permit',
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

export function packReadme(entry, path, pinDemoNote = null) {
  const pinBlock = pinDemoNote ? `\n## SAMPLE_LAB Studio → TSB pin demo\n\n${pinDemoNote}\n` : '';
  return `# ${entry['Canonical Service ID']} — ${entry['Normalized National Definition']}

SAMPLE_LAB configurable authoring pack with **SAMPLE_LAB DUMMY** defaults (synthetic · not statute).

- Authoring path: \`${path}\`
- Dummy inventory: \`SAMPLE_LAB_DUMMY.md\`
- Shared defaults: \`../sample-lab-dummy/defaults.json\`
- Per-id overlay: \`owner-config.json\`
- Tenant / TSB overlay schema: \`../sample-lab-dummy/tenant-overlay.schema.json\`
- Owner JSON Schema: \`../owner-config.schema.json\`
${pinBlock}
Merge order: shared defaults → per-id owner-config → CMP-052 tenant overlay.
Fail-closed outside SAMPLE_LAB. Owner must replace before any non-lab use.
Citizen apply still requires a PUBLISHED TSB placement — Licence/Permit remain **not citizen-offerable** until owner statute + placement.
CERTIFIED=false · G6=false · self_certified=false.
`;
}

/**
 * Append pin-demo workflow / inspection / schedule metadata to a rendered workflow.yaml.
 * Keeps the shared WAIT-only shell; nodes are opaque metadata refs only (not statute).
 */
export function appendPinDemoWorkflowExtras(workflowYaml, pinDemo) {
  if (!pinDemo) return workflowYaml;
  const nodes = (pinDemo.workflow_nodes ?? []).map((n) => `    - ${n}`).join('\n');
  const appt = pinDemo.appointment_type_ref
    ? `  appointment_type_ref: ${pinDemo.appointment_type_ref}\n`
    : '';
  const insp = pinDemo.inspection_pin_code
    ? `  inspection_pin_code: ${pinDemo.inspection_pin_code}\n`
    : '';
  const extras = `
# SAMPLE_LAB Studio → TSB pin-demo metadata (not citizen-offerable; DRAFT/DUMMY only)
pin_demo:
  catalogue_id: ${pinDemo.catalogue_id}
  output_type: ${pinDemo.output_type}
  citizen_offerable: false
  policy_kind: SAMPLE_LAB_DUMMY
${insp}${appt}  workflow_nodes:
${nodes || '    - SITE_VERIFY'}
`;
  return `${workflowYaml.trimEnd()}\n${extras}`;
}

export function writePackFiles({
  entry,
  path,
  skeletons,
  defaults,
  outRoot,
  fixturesRoot,
  pinDemo = null,
}) {
  const catalogueId = entry['Canonical Service ID'];
  const idLower = packDirName(catalogueId);
  const idUnderscore = catalogueId.replaceAll('-', '_');
  const dir = join(outRoot, idLower);
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
    let body = render(skeletons[tmplName], vars);
    if (outName === 'workflow.yaml' && pinDemo) {
      body = appendPinDemoWorkflowExtras(body, pinDemo);
    }
    writeFileSync(join(dir, outName), body);
  }
  writeFileSync(
    join(dir, 'form.schema.json'),
    `${JSON.stringify(formSchema(entry, idLower), null, 2)}\n`,
  );

  const pinNote = pinDemo
    ? [
        'This pack is a **SAMPLE_LAB pin-demo target**: Studio can author form/workflow/rules',
        'and a lab TSB pin graph can reference those versions. **Not** on citizen placement.',
        `Inspection pin: \`${pinDemo.inspection_pin_code ?? '(none)'}\`.`,
        `Appointment type: \`${pinDemo.appointment_type_ref ?? '(none)'}\`.`,
        'See `fixtures/lab/platform/licence-permit-pin-demos.json`.',
      ].join(' ')
    : null;

  writeFileSync(join(dir, 'README.md'), packReadme(entry, path, pinNote));
  writeFileSync(
    join(dir, 'owner-config.json'),
    `${JSON.stringify(
      {
        ...ownerConfig(catalogueId, idUnderscore),
        ...(pinDemo
          ? {
              pin_demo: {
                enabled: true,
                citizen_offerable: false,
                inspection_pin_code: pinDemo.inspection_pin_code ?? null,
                appointment_type_ref: pinDemo.appointment_type_ref ?? null,
                workflow_nodes: pinDemo.workflow_nodes ?? [],
              },
            }
          : {}),
      },
      null,
      2,
    )}\n`,
  );

  mkdirSync(fixturesRoot, { recursive: true });
  writeFileSync(
    join(fixturesRoot, `${idLower}.SAMPLE_LAB_DUMMY.md`),
    render(skeletons['SAMPLE_LAB_DUMMY.md.tmpl'], vars),
  );
  const obsolete = join(fixturesRoot, `${idLower}.POLICY_INPUT_REQUIRED.md`);
  if (existsSync(obsolete)) rmSync(obsolete);

  const hash = createHash('sha256')
    .update(catalogueId)
    .update(entry['Normalized National Definition'])
    .update(JSON.stringify(defaults.fee))
    .digest('hex')
    .slice(0, 16);

  return {
    catalogue_id: catalogueId,
    authoring_path: path,
    generator: 'certificate-pack-factory',
    status: 'SAMPLE_LAB_STUB',
    policy_kind: 'SAMPLE_LAB_DUMMY',
    output_type: entry['Service / Output Type'],
    content_fingerprint: hash,
    ...(pinDemo
      ? {
          pin_demo: true,
          citizen_offerable: false,
          inspection_pin_code: pinDemo.inspection_pin_code ?? null,
          appointment_type_ref: pinDemo.appointment_type_ref ?? null,
        }
      : {}),
  };
}
