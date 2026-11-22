#!/usr/bin/env node
/**
 * Generate SAMPLE_LAB configurable authoring packs for Certificate + Licence + Permit catalogue stubs.
 * Fills SAMPLE_LAB DUMMY owner-config defaults (synthetic, not statute) + per-id overlays.
 * Tenants override via CMP-052 / tenant-overlay.schema.json. Fail-closed outside SAMPLE_LAB.
 * Skips Residence (PUBLISHED Odisha sample) and Income (hand-crafted M11 shell — updated separately).
 * Licence/Permit pin-demo targets get workflow/inspection/schedule metadata overlays.
 *
 * Usage: node scripts/catalogue/generate-certificate-packs.mjs
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEEP_DIRS,
  SKIP_IDS,
  TMPL_FILES,
  authoringPath,
  writePackFiles,
} from './lib/pack-factory.mjs';
import {
  buildLicencePermitPinDemoCatalogue,
  pinDemoByCatalogueId,
} from './lib/licence-permit-pin-demos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const UNIVERSE = join(ROOT, 'packages/service-templates/src/catalogue/certificate-universe.json');
const LP_UNIVERSE = join(
  ROOT,
  'packages/service-templates/src/catalogue/licence-permit-universe.json',
);
const SKELETON = join(ROOT, 'templates/certificate-pack-skeleton');
const OUT = join(ROOT, 'templates/certificate-packs');
const FIXTURES = join(ROOT, 'fixtures/catalogue/certificate-packs');
const DEFAULTS = join(OUT, 'sample-lab-dummy/defaults.json');
const PIN_DEMOS_OUT = join(ROOT, 'fixtures/lab/platform/licence-permit-pin-demos.json');

function main() {
  const universe = JSON.parse(readFileSync(UNIVERSE, 'utf8'));
  if (universe.filter.equals !== 'Certificate') {
    throw new Error('universe filter must be Certificate');
  }
  const lpUniverse = JSON.parse(readFileSync(LP_UNIVERSE, 'utf8'));
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
      'SAMPLE_LAB DUMMY factory output — Certificate + Licence + Permit; tenant-overridable jurisdiction.allowed_states/districts/municipalities; Licence/Permit pin-demo overlays for Studio→TSB demos; not CERTIFIED; G6=false; Licence/Permit not citizen-offerable',
    catalogue_version: universe.catalogue_version,
    source: universe.source,
    filter: universe.filter,
    licence_permit_filter: lpUniverse.filter,
    policy_kind: 'SAMPLE_LAB_DUMMY',
    defaults_ref: 'templates/certificate-packs/sample-lab-dummy/defaults.json',
    tenant_overlay_schema_ref:
      'templates/certificate-packs/sample-lab-dummy/tenant-overlay.schema.json',
    pin_demos_ref: 'fixtures/lab/platform/licence-permit-pin-demos.json',
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
        output_type: 'Certificate',
      });
      continue;
    }

    const pack = writePackFiles({
      entry,
      path,
      skeletons,
      defaults,
      outRoot: OUT,
      fixturesRoot: FIXTURES,
    });
    manifest.packs.push(pack);
    generated += 1;
  }

  for (const entry of lpUniverse.entries) {
    const catalogueId = entry['Canonical Service ID'];
    const pinDemo = pinDemoByCatalogueId(catalogueId);
    const pack = writePackFiles({
      entry,
      path: authoringPath(catalogueId),
      skeletons,
      defaults,
      outRoot: OUT,
      fixturesRoot: FIXTURES,
      pinDemo,
    });
    pack.note = `Registry ${entry['Service / Output Type']} — same tenant jurisdiction scope pattern`;
    if (pinDemo) {
      pack.note += '; SAMPLE_LAB Studio→TSB pin-demo target (not citizen-offerable)';
    }
    manifest.packs.push(pack);
    generated += 1;
  }

  // Birth Registration is outside the Certificate filter but has a catalogue stub.
  const birthPath = 'templates/certificate-packs/ind-civ-001/';
  const birthDir = join(OUT, 'ind-civ-001');
  // Always regenerate Birth so wipe-above does not leave a hole.
  {
    void birthDir;
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
      'Recommended Credential Form': 'Digitally signed PDF + QR',
    };
    const pack = writePackFiles({
      entry: birthEntry,
      path: birthPath,
      skeletons,
      defaults,
      outRoot: OUT,
      fixturesRoot: FIXTURES,
    });
    pack.note = 'Registration exception outside Certificate filter';
    manifest.packs.push(pack);
    generated += 1;
  }

  manifest.generated_pack_count = generated;
  manifest.total_manifest_entries = manifest.packs.length;
  manifest.pin_demo_catalogue_ids = LICENCE_PERMIT_PIN_DEMO_IDS();
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const pinDemoCatalogue = buildLicencePermitPinDemoCatalogue();
  writeFileSync(PIN_DEMOS_OUT, `${JSON.stringify(pinDemoCatalogue, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        generated,
        policy_kind: 'SAMPLE_LAB_DUMMY',
        skipped_handcrafted: [...SKIP_IDS],
        licence_permit: lpUniverse.count,
        pin_demos: pinDemoCatalogue.targets.length,
        citizen_offerable_licence_permit: 0,
        manifest_entries: manifest.packs.length,
        out: 'templates/certificate-packs/',
        pin_demos_out: 'fixtures/lab/platform/licence-permit-pin-demos.json',
      },
      null,
      2,
    ),
  );
}

function LICENCE_PERMIT_PIN_DEMO_IDS() {
  return buildLicencePermitPinDemoCatalogue().targets.map((t) => t.catalogue_id);
}

main();
