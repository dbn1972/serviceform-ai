import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CertificateTemplate, PolicyFacts } from './types';

/**
 * SAMPLE_LAB DUMMY owner-config defaults + tenant/TSB overlay merge.
 * Synthetic only — not statute, not for production, CERTIFIED=false, G6=false.
 * Fail-closed outside environment_label === SAMPLE_LAB.
 */

export const SAMPLE_LAB_DUMMY_KIND = 'SAMPLE_LAB_DUMMY' as const;
export const SAMPLE_LAB_ENVIRONMENT = 'SAMPLE_LAB' as const;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULTS_PATH = join(
  ROOT,
  'templates/certificate-packs/sample-lab-dummy/defaults.json',
);

/** Catalogue-facing policy facts stamped SAMPLE_LAB DUMMY (tenant-overridable defaults). */
export const SAMPLE_LAB_DUMMY_POLICY_FACTS: PolicyFacts = {
  fee: 'SAMPLE_LAB DUMMY · ₹9.99 (tenant-overridable)',
  service_time: 'SAMPLE_LAB DUMMY · 15 working days (tenant-overridable)',
  eligibility: 'SAMPLE_LAB DUMMY · synthetic eligibility (not statutory)',
  evidence: 'SAMPLE_LAB DUMMY · synthetic evidence list (not statutory)',
  source:
    'templates/certificate-packs/sample-lab-dummy/defaults.json (tenant/TSB overlayable via CMP-052)',
};

export type SampleLabDummyDefaults = Record<string, unknown> & {
  policy_kind: typeof SAMPLE_LAB_DUMMY_KIND;
  not_for_production: true;
  not_statutory: true;
  certified: false;
  g6: false;
};

export interface SampleLabTenantOverlay {
  tenant_id: string;
  catalogue_id: string;
  tenant_service_binding_id?: string;
  jurisdiction_code?: string;
  environment_label?: typeof SAMPLE_LAB_ENVIRONMENT;
  jurisdiction?: Record<string, unknown>;
  legal_basis?: Record<string, unknown>;
  eligibility?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  fee?: Record<string, unknown>;
  service_time?: Record<string, unknown>;
  credential?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  access?: Record<string, unknown>;
}

export interface PerIdOwnerConfigOverlay {
  catalogue_id: string;
  defaults_ref: string;
  policy_kind: typeof SAMPLE_LAB_DUMMY_KIND;
  not_for_production: true;
  not_statutory: true;
  credential?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge plain objects; arrays and scalars from `patch` replace. */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  ...patches: Array<Record<string, unknown> | undefined | null>
): T {
  let out: Record<string, unknown> = { ...base };
  for (const patch of patches) {
    if (!patch) continue;
    for (const [key, value] of Object.entries(patch)) {
      if (key === '_comment') continue;
      const prev = out[key];
      if (isPlainObject(prev) && isPlainObject(value)) {
        out[key] = deepMerge(prev, value);
      } else {
        out[key] = value;
      }
    }
  }
  return out as T;
}

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

/** True when this environment may consume SAMPLE_LAB DUMMY policy. */
export function sampleLabDummyAllowed(environmentLabel: string | undefined | null): boolean {
  return environmentLabel === SAMPLE_LAB_ENVIRONMENT;
}

/**
 * Fail-closed gate: SAMPLE_LAB DUMMY must not leak into UAT/PREPROD/PRODUCTION.
 * Call before applying dummy defaults or tenant overlays outside the lab.
 */
export function assertSampleLabDummyAllowed(environmentLabel: string | undefined | null): void {
  if (!sampleLabDummyAllowed(environmentLabel)) {
    throw new Error(
      'SAMPLE_LAB_DUMMY policy refused outside SAMPLE_LAB (fail-closed; not for production)',
    );
  }
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
    throw new Error(
      `tenant overlay catalogue_id ${tenantOverlay.catalogue_id} !== ${catalogueId}`,
    );
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

/** True when catalogue policy facts are the SAMPLE_LAB DUMMY stamp (not POLICY_INPUT_REQUIRED). */
export function usesSampleLabDummyPolicy(template: CertificateTemplate): boolean {
  const { fee, service_time, eligibility, evidence, source } = template.policy;
  // Catalogue copy uses spaced "SAMPLE_LAB DUMMY"; JSON policy_kind uses SAMPLE_LAB_DUMMY.
  return [fee, service_time, eligibility, evidence, source].some(
    (v) => v.includes('SAMPLE_LAB DUMMY') || v.includes(SAMPLE_LAB_DUMMY_KIND),
  );
}
