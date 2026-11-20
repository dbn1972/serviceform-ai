import type { CertificateTemplate, PolicyFacts } from './types';

/**
 * SAMPLE_LAB sample parameters (configurable) — browser-safe catalogue helpers.
 * Defaults are starting lab values only — editable per tenant; not locked statute.
 * File-backed resolve lives in `./sample-lab-dummy-resolve` (Node-only; not re-exported here).
 * Not for production. CERTIFIED=false, G6=false.
 * Fail-closed outside environment_label === SAMPLE_LAB.
 */

export const SAMPLE_LAB_DUMMY_KIND = 'SAMPLE_LAB_DUMMY' as const;
export const SAMPLE_LAB_ENVIRONMENT = 'SAMPLE_LAB' as const;

/** Catalogue-facing policy facts: SAMPLE_LAB sample parameters (configurable per tenant). */
export const SAMPLE_LAB_DUMMY_POLICY_FACTS: PolicyFacts = {
  fee: 'SAMPLE_LAB sample · ₹9.99 (configurable per tenant)',
  service_time: 'SAMPLE_LAB sample · 15 working days (configurable per tenant)',
  eligibility: 'SAMPLE_LAB sample parameters (configurable) — eligibility',
  evidence: 'SAMPLE_LAB sample parameters (configurable) — evidence',
  source:
    'templates/certificate-packs/sample-lab-dummy/defaults.json (SAMPLE_LAB sample parameters; CMP-052 tenant-overridable)',
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
  const out: Record<string, unknown> = { ...base };
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

/** True when this environment may consume SAMPLE_LAB sample parameters. */
export function sampleLabDummyAllowed(environmentLabel: string | undefined | null): boolean {
  return environmentLabel === SAMPLE_LAB_ENVIRONMENT;
}

/**
 * Fail-closed gate: SAMPLE_LAB sample parameters must not leak into UAT/PREPROD/PRODUCTION.
 */
export function assertSampleLabDummyAllowed(environmentLabel: string | undefined | null): void {
  if (!sampleLabDummyAllowed(environmentLabel)) {
    throw new Error(
      'SAMPLE_LAB_DUMMY policy refused outside SAMPLE_LAB (fail-closed; not for production)',
    );
  }
}

/** True when catalogue policy facts are SAMPLE_LAB sample parameters (not POLICY_INPUT_REQUIRED). */
export function usesSampleLabDummyPolicy(template: CertificateTemplate): boolean {
  const { fee, service_time, eligibility, evidence, source } = template.policy;
  // Accept prior "SAMPLE_LAB DUMMY" copy and current "SAMPLE_LAB sample" wording.
  return [fee, service_time, eligibility, evidence, source].some(
    (v) =>
      v.includes('SAMPLE_LAB DUMMY') ||
      v.includes('SAMPLE_LAB sample') ||
      v.includes(SAMPLE_LAB_DUMMY_KIND),
  );
}
