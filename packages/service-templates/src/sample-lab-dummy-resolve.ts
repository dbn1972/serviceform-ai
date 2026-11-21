/**
 * Node-only SAMPLE_LAB sample-parameter resolve (reads owner-config JSON from disk).
 * Do not import from Next.js client bundles — use `@serviceform/service-templates/sample-lab-dummy-resolve`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import {
  extractJurisdictionScope,
  resolveJurisdictionScope,
  type JurisdictionScope,
} from './jurisdiction-scope';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULTS_PATH = join(ROOT, 'templates/certificate-packs/sample-lab-dummy/defaults.json');
const TENANT_OVERLAY_ROOT = join(ROOT, 'fixtures/lab/platform/tenant-overlays');

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

export function loadPerIdOwnerConfig(catalogueId: string): PerIdOwnerConfigOverlay | null {
  const relative =
    HANDCRAFTED_OWNER_CONFIG[catalogueId] ??
    `templates/certificate-packs/${catalogueId.toLowerCase()}/owner-config.json`;
  const path = join(ROOT, relative);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as PerIdOwnerConfigOverlay;
}

function overlayPath(tenantId: string, catalogueId: string): string {
  return join(TENANT_OVERLAY_ROOT, tenantId, `${catalogueId.toUpperCase()}.json`);
}

/** Load a persisted SAMPLE_LAB tenant/TSB overlay (any catalogue offering id). */
export function loadTenantOverlay(
  tenantId: string,
  catalogueId: string,
): SampleLabTenantOverlay | null {
  const path = overlayPath(tenantId, catalogueId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as SampleLabTenantOverlay;
}

/**
 * Persist a SAMPLE_LAB tenant/TSB overlay for any catalogue offering
 * (Certificate, Licence, Permit, Registration, …). Fail-closed outside SAMPLE_LAB.
 */
export function saveTenantOverlay(overlay: SampleLabTenantOverlay): SampleLabTenantOverlay {
  assertSampleLabDummyAllowed(overlay.environment_label ?? SAMPLE_LAB_ENVIRONMENT);
  if (!/^[0-9a-f-]{36}$/i.test(overlay.tenant_id)) {
    throw new Error('tenant_id must be a UUID');
  }
  if (!/^IND-[A-Z]{3}-[0-9]{3}$/.test(overlay.catalogue_id)) {
    throw new Error('catalogue_id must match IND-XXX-000');
  }
  const dir = join(TENANT_OVERLAY_ROOT, overlay.tenant_id);
  mkdirSync(dir, { recursive: true });
  const stored: SampleLabTenantOverlay = {
    ...overlay,
    catalogue_id: overlay.catalogue_id.toUpperCase(),
    environment_label: SAMPLE_LAB_ENVIRONMENT,
  };
  writeFileSync(overlayPath(overlay.tenant_id, stored.catalogue_id), `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

/**
 * Resolve owner-config for a catalogue id:
 * shared defaults → per-id overlay (if pack exists) → optional tenant/TSB overlay.
 * Works for Certificate, Licence, Permit and other registry offerings.
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
    (perId ?? { catalogue_id: catalogueId }) as unknown as Record<string, unknown>,
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

/** Resolve jurisdiction.allowed_states / allowed_districts for a tenant+offering. */
export function resolveTenantJurisdictionScope(input: {
  catalogueId: string;
  tenantId?: string | null;
  tenantOverlay?: SampleLabTenantOverlay | null;
  environmentLabel?: string | null;
}): JurisdictionScope {
  const overlay =
    input.tenantOverlay ??
    (input.tenantId ? loadTenantOverlay(input.tenantId, input.catalogueId) : null);
  const resolved = resolveSampleLabOwnerConfig(
    input.catalogueId,
    overlay,
    input.environmentLabel ?? SAMPLE_LAB_ENVIRONMENT,
  );
  return resolveJurisdictionScope(resolved, input.environmentLabel ?? SAMPLE_LAB_ENVIRONMENT);
}

export { extractJurisdictionScope, TENANT_OVERLAY_ROOT };
