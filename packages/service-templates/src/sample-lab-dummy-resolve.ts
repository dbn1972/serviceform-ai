/**
 * Node-only SAMPLE_LAB sample-parameter resolve (reads owner-config JSON from disk).
 * Do not import from Next.js client bundles — use `@serviceform/service-templates/sample-lab-dummy-resolve`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_LAB_DUMMY_KIND,
  SAMPLE_LAB_ENVIRONMENT,
  assertSampleLabDummyAllowed,
  deepMerge,
  type PerIdOwnerConfigOverlay,
  type SampleLabDummyDefaults,
  type SampleLabTenantOverlay,
} from './sample-lab-dummy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULTS_PATH = join(ROOT, 'templates/certificate-packs/sample-lab-dummy/defaults.json');

export function loadSampleLabDummyDefaults(): SampleLabDummyDefaults {
  const raw = JSON.parse(readFileSync(DEFAULTS_PATH, 'utf8')) as SampleLabDummyDefaults;
  if (raw.policy_kind !== SAMPLE_LAB_DUMMY_KIND) {
    throw new Error(`defaults.json policy_kind must be ${SAMPLE_LAB_DUMMY_KIND}`);
  }
  return raw;
}

const HANDCRAFTED_OWNER_CONFIG: Record<string, string> = {
  'IND-SOC-031': 'templates/income-certificate/owner-config.json',
};

export function loadPerIdOwnerConfig(catalogueId: string): PerIdOwnerConfigOverlay {
  const relative =
    HANDCRAFTED_OWNER_CONFIG[catalogueId] ??
    `templates/certificate-packs/${catalogueId.toLowerCase()}/owner-config.json`;
  const path = join(ROOT, relative);
  return JSON.parse(readFileSync(path, 'utf8')) as PerIdOwnerConfigOverlay;
}

/**
 * Resolve owner-config for a catalogue id:
 * shared defaults → per-id overlay → optional tenant/TSB overlay.
 */
export function resolveSampleLabOwnerConfig(
  catalogueId: string,
  tenantOverlay?: SampleLabTenantOverlay | null,
  environmentLabel: string | undefined | null = SAMPLE_LAB_ENVIRONMENT,
): Record<string, unknown> {
  assertSampleLabDummyAllowed(environmentLabel);
  if (tenantOverlay && tenantOverlay.catalogue_id !== catalogueId) {
    throw new Error(`tenant overlay catalogue_id ${tenantOverlay.catalogue_id} !== ${catalogueId}`);
  }
  if (tenantOverlay?.environment_label) {
    assertSampleLabDummyAllowed(tenantOverlay.environment_label);
  }
  const defaults = loadSampleLabDummyDefaults();
  const perId = loadPerIdOwnerConfig(catalogueId);
  const {
    tenant_id: _t,
    catalogue_id: _c,
    tenant_service_binding_id: _b,
    jurisdiction_code: _j,
    environment_label: _e,
    ...overlayFields
  } = tenantOverlay ?? {};
  const resolved = deepMerge(
    defaults as unknown as Record<string, unknown>,
    perId as unknown as Record<string, unknown>,
    overlayFields as Record<string, unknown>,
  );
  return {
    ...resolved,
    catalogue_id: catalogueId,
    policy_kind: SAMPLE_LAB_DUMMY_KIND,
    not_for_production: true,
    not_statutory: true,
    certified: false,
    g6: false,
    self_certified: false,
    tenant_id: tenantOverlay?.tenant_id ?? null,
    tenant_service_binding_id: tenantOverlay?.tenant_service_binding_id ?? null,
    jurisdiction_code: tenantOverlay?.jurisdiction_code ?? null,
  };
}
