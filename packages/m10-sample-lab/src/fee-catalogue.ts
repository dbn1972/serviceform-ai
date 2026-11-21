/**
 * SAMPLE_LAB DUMMY fee catalogue helpers (SF-56 / CMP-020+021).
 * Labeled non-statutory overlay — not Residence ₹0. Payment REAL owner-held.
 * CERTIFIED=false. G6=false.
 */

export const SAMPLE_LAB_FEE_DEFAULTS = {
  source: 'SAMPLE_LAB',
  policy_kind: 'SAMPLE_LAB_DUMMY',
  not_statutory: true,
  not_for_production: true,
  certified: false,
  g6: false,
  test_run_id: 'sample-lab-payment',
  connector_binding_id: '0d15ba00-0021-4000-8000-0d15ba000021',
  /** IND-EDU-004 Transfer Certificate — distinct from Residence fee pin. */
  ind_edu_004_fee_policy_version_id: '0d15bae4-0015-4000-8000-0d15bae40015',
  amount_minor: 999,
  currency: 'INR',
  amount_display: 'SAMPLE_LAB DUMMY · ₹9.99',
} as const;

export type SampleLabFeePolicyRow = {
  catalogue_id: string;
  label: string;
  fee_policy_version_id: string;
  tenant_id: string;
  tenant_service_binding_id: string;
  publication_status: 'PUBLISHED';
  content_hash: string;
  currency: string;
  rule_version_id: string | null;
  waiver_policy_ref: string | null;
  amount_minor: number;
  amount_display: string;
  fee_schedule_ref: string;
  lines: {
    code: string;
    basis: 'FIXED_AMOUNT';
    amount_minor: number;
    description_code?: string;
  }[];
};

export type SampleLabFeeCatalogue = {
  source: string;
  policy_kind: string;
  test_run_id: string;
  connector: {
    connector_binding_id: string;
    connector_type: 'PAYMENT';
    mode: 'SIMULATED';
    simulator_version: string;
    critical: boolean;
  };
  workload: {
    payment_actor_id: string;
    payment_roles: readonly string[];
    integration_actor_id: string;
    integration_roles: readonly string[];
  };
  policies: SampleLabFeePolicyRow[];
};

/** Built-in IND-EDU-004 SAMPLE_LAB DUMMY fee>0 row (mirrors fixtures/lab/platform/fee-catalogue.json). */
export const SAMPLE_LAB_FEE_CATALOGUE: SampleLabFeeCatalogue = {
  source: 'SAMPLE_LAB',
  policy_kind: 'SAMPLE_LAB_DUMMY',
  test_run_id: SAMPLE_LAB_FEE_DEFAULTS.test_run_id,
  connector: {
    connector_binding_id: SAMPLE_LAB_FEE_DEFAULTS.connector_binding_id,
    connector_type: 'PAYMENT',
    mode: 'SIMULATED',
    simulator_version: 'sample-lab-psp-1',
    critical: false,
  },
  workload: {
    payment_actor_id: '0d15ba00-0021-4000-8000-0d15ba00021a',
    payment_roles: ['SAMPLE_LAB_PAYMENT_WORKLOAD'],
    integration_actor_id: '0d15ba00-0021-4000-8000-0d15ba00021b',
    integration_roles: ['SAMPLE_LAB_PAYMENT_INTEGRATION'],
  },
  policies: [
    {
      catalogue_id: 'IND-EDU-004',
      label: 'SAMPLE_LAB DUMMY · Transfer Certificate fee overlay (₹9.99)',
      fee_policy_version_id: SAMPLE_LAB_FEE_DEFAULTS.ind_edu_004_fee_policy_version_id,
      tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
      tenant_service_binding_id: '0d15bae4-0002-4000-8000-0d15bae40002',
      publication_status: 'PUBLISHED',
      content_hash:
        'sha256:9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f',
      currency: 'INR',
      rule_version_id: null,
      waiver_policy_ref: null,
      amount_minor: 999,
      amount_display: SAMPLE_LAB_FEE_DEFAULTS.amount_display,
      fee_schedule_ref: 'SAMPLE_LAB_DUMMY_FEE_SCHEDULE',
      lines: [
        {
          code: 'SAMPLE_LAB_DUMMY_BASE',
          basis: 'FIXED_AMOUNT',
          amount_minor: 999,
          description_code: 'SAMPLE_LAB_DUMMY_FEE',
        },
      ],
    },
  ],
};

export function feePolicyForCatalogue(
  catalogue: SampleLabFeeCatalogue,
  catalogueId: string,
): SampleLabFeePolicyRow | null {
  return catalogue.policies.find((p) => p.catalogue_id === catalogueId) ?? null;
}

/** True when SAMPLE_LAB DUMMY overlay pins a fee amount > 0 (not Residence ₹0). */
export function requiresLabPayment(
  catalogueId: string,
  catalogue: SampleLabFeeCatalogue = SAMPLE_LAB_FEE_CATALOGUE,
): boolean {
  const row = feePolicyForCatalogue(catalogue, catalogueId);
  return row !== null && row.amount_minor > 0;
}
