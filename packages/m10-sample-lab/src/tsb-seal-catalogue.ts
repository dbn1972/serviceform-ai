/**
 * SAMPLE_LAB TSB immutability seal engineering helpers (SF-60).
 * Proves published pin-graph hash stability + mutation refusal for lab only.
 * Does NOT flip G6/production `tsb_immutability_sealed`. CERTIFIED=false. G6=false.
 */

import { createHash } from 'node:crypto';

export const SAMPLE_LAB_TSB_SEAL_DEFAULTS = {
  source: 'SAMPLE_LAB',
  mode: 'SAMPLE_LAB' as const,
  policy_kind: 'SAMPLE_LAB_ENG_SEAL',
  not_statutory: true,
  not_for_production: true,
  certified: false,
  g6: false,
  /** G6/production seal gate — remains false until REAL DigiLocker/DLT + human G6. */
  tsb_immutability_sealed: false,
  production_digilocker_ready: false,
  production_dlt_ready: false,
  test_run_id: 'sample-lab-tsb-seal',
  catalogue_id: 'IND-SOC-002',
  tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
  /** Placement / fixture binding id used on SAMPLE_LAB Residence. */
  tenant_service_binding_id: '0d15ba00-0002-4000-8000-0d15ba0000d2',
  binding_key: 'ind-soc-002.sample-lab',
  offering_ref: 'IND-SOC-002',
  metadata_bundle_ref: 'bundle.ind-soc-002.sample-lab.v1',
  pin_content_hash: 'sha256:abababababababababababababababababababababababababababababababab',
  artifact_hash: 'sha256:62ac3e74e877b0c045cedcf10d34c4b253dcc6f2c98cd187e37cfb72fea3f4af',
} as const;

export const TSB_SEAL_PIN_KEYS = [
  'service',
  'offering',
  'form',
  'rules',
  'evidence',
  'fee',
  'workflow',
  'sla',
  'access',
  'credential',
  'notification',
  'authorization_policy',
] as const;

export type TsbSealPinKey = (typeof TSB_SEAL_PIN_KEYS)[number];

export type TsbSealPinRef = {
  version_ref: string;
  content_hash: string;
};

export type TsbSealPinMap = Record<TsbSealPinKey, TsbSealPinRef>;

export type LabTsbSealTarget = {
  catalogue_id: string;
  tenant_id: string;
  tenant_service_binding_id: string;
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  status: 'PUBLISHED';
  pins: TsbSealPinMap;
  artifact_hash: string;
  label: string;
};

export type LabTsbSealCatalogue = {
  source: string;
  policy_kind: string;
  test_run_id: string;
  mode: 'SAMPLE_LAB';
  certified: false;
  g6: false;
  tsb_immutability_sealed: false;
  production_digilocker_ready: false;
  production_dlt_ready: false;
  targets: LabTsbSealTarget[];
};

export type LabTsbSealAttestation = {
  lab_eng_sealed: boolean;
  sealed_at: string | null;
  binding_id: string;
  catalogue_id: string;
  artifact_hash: string;
  hash_verified: boolean;
  mutation_refused: boolean;
  status: string;
  mode: 'SAMPLE_LAB';
  /** Always false — owner/human G6 seal claim. */
  tsb_immutability_sealed: false;
  certified: false;
  g6: false;
  production_digilocker_ready: false;
  production_dlt_ready: false;
  reason_codes: string[];
};

function sha256Fingerprint(parts: readonly string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

/** Mirrors CMP-052 `artifactHash` (content-addressed pin graph). */
export function labArtifactHash(input: {
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  pins: TsbSealPinMap;
}): string {
  const graph = TSB_SEAL_PIN_KEYS.map(
    (kind) => `${kind}:${input.pins[kind].version_ref}:${input.pins[kind].content_hash}`,
  ).join(',');
  return sha256Fingerprint([
    input.binding_key,
    input.offering_ref,
    input.metadata_bundle_ref,
    graph,
  ]);
}

export function sampleLabResidencePins(): TsbSealPinMap {
  const hash = SAMPLE_LAB_TSB_SEAL_DEFAULTS.pin_content_hash;
  const pins = {} as TsbSealPinMap;
  for (const key of TSB_SEAL_PIN_KEYS) {
    pins[key] = {
      version_ref: `ind-soc-002-${key}-v1@0.2.0-sample-lab`,
      content_hash: hash,
    };
  }
  return pins;
}

/** Built-in IND-SOC-002 SAMPLE_LAB seal target (mirrors fixtures/lab/platform/tsb-seal-catalogue.json). */
export const SAMPLE_LAB_TSB_SEAL_CATALOGUE: LabTsbSealCatalogue = {
  source: SAMPLE_LAB_TSB_SEAL_DEFAULTS.source,
  policy_kind: SAMPLE_LAB_TSB_SEAL_DEFAULTS.policy_kind,
  test_run_id: SAMPLE_LAB_TSB_SEAL_DEFAULTS.test_run_id,
  mode: 'SAMPLE_LAB',
  certified: false,
  g6: false,
  tsb_immutability_sealed: false,
  production_digilocker_ready: false,
  production_dlt_ready: false,
  targets: [
    {
      catalogue_id: SAMPLE_LAB_TSB_SEAL_DEFAULTS.catalogue_id,
      tenant_id: SAMPLE_LAB_TSB_SEAL_DEFAULTS.tenant_id,
      tenant_service_binding_id: SAMPLE_LAB_TSB_SEAL_DEFAULTS.tenant_service_binding_id,
      binding_key: SAMPLE_LAB_TSB_SEAL_DEFAULTS.binding_key,
      offering_ref: SAMPLE_LAB_TSB_SEAL_DEFAULTS.offering_ref,
      metadata_bundle_ref: SAMPLE_LAB_TSB_SEAL_DEFAULTS.metadata_bundle_ref,
      status: 'PUBLISHED',
      pins: sampleLabResidencePins(),
      artifact_hash: SAMPLE_LAB_TSB_SEAL_DEFAULTS.artifact_hash,
      label: 'SAMPLE_LAB eng seal · Residence Certificate (IND-SOC-002)',
    },
  ],
};

export function isSampleLabSealEnvironment(environment: string): boolean {
  return environment === 'LOCAL' || environment === 'CI';
}

/**
 * Lab eng seal prove: PUBLISHED + hash stable + mutation refused.
 * Never sets G6/production `tsb_immutability_sealed`.
 */
export function proveLabTsbEngSeal(input: {
  environment: string;
  source?: string;
  now?: string;
  binding: {
    binding_id: string;
    catalogue_id?: string;
    binding_key: string;
    offering_ref: string;
    metadata_bundle_ref: string;
    status: string;
    pins: TsbSealPinMap;
    artifact_hash: string;
  };
}): LabTsbSealAttestation {
  const reasons: string[] = [];
  const source = input.source ?? 'SAMPLE_LAB';
  if (source !== 'SAMPLE_LAB') reasons.push('SOURCE_NOT_SAMPLE_LAB');
  if (!isSampleLabSealEnvironment(input.environment)) reasons.push('ENV_NOT_LAB');
  if (input.binding.status !== 'PUBLISHED') reasons.push('NOT_PUBLISHED');

  let recomputed = '';
  let hashVerified = false;
  try {
    recomputed = labArtifactHash({
      binding_key: input.binding.binding_key,
      offering_ref: input.binding.offering_ref,
      metadata_bundle_ref: input.binding.metadata_bundle_ref,
      pins: input.binding.pins,
    });
    hashVerified = recomputed === input.binding.artifact_hash;
    if (!hashVerified) reasons.push('HASH_MISMATCH');
  } catch {
    reasons.push('HASH_COMPUTE_FAILED');
  }

  /** Published rows are immutable — eng seal requires the mutation gate to fire. */
  const mutationRefused = input.binding.status === 'PUBLISHED';
  if (!mutationRefused) reasons.push('MUTATION_GATE_OPEN');

  const ok = reasons.length === 0 && hashVerified && mutationRefused;

  return {
    lab_eng_sealed: ok,
    sealed_at: ok ? (input.now ?? new Date().toISOString()) : null,
    binding_id: input.binding.binding_id,
    catalogue_id: input.binding.catalogue_id ?? input.binding.offering_ref,
    artifact_hash: input.binding.artifact_hash,
    hash_verified: hashVerified,
    mutation_refused: mutationRefused,
    status: input.binding.status,
    mode: 'SAMPLE_LAB',
    tsb_immutability_sealed: false,
    certified: false,
    g6: false,
    production_digilocker_ready: false,
    production_dlt_ready: false,
    reason_codes: reasons,
  };
}

export function targetForBinding(
  catalogue: LabTsbSealCatalogue,
  bindingId: string,
): LabTsbSealTarget | null {
  return catalogue.targets.find((t) => t.tenant_service_binding_id === bindingId) ?? null;
}

export function targetForCatalogue(
  catalogue: LabTsbSealCatalogue,
  catalogueId: string,
): LabTsbSealTarget | null {
  return catalogue.targets.find((t) => t.catalogue_id === catalogueId) ?? null;
}
