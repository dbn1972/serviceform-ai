import { Cmp022Error, detail } from '../errors.js';
import type {
  ConnectorMode,
  SigningAdapterResult,
  SimulationMarker,
} from '../ports/signing-port.js';
import { isErrorCode, isOpaqueRef, isScenario, isSha256Hex, isStorageKey } from './charset.js';
import { isUuid } from './uuid.js';

export const DEPLOYMENT_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

/** SF-CON-CONNECTOR-BINDING / SF-CON-SIMULATION-MARKER: SIMULATED is legal only here. */
export const SIMULATION_ENVIRONMENTS: ReadonlySet<DeploymentEnvironment> = new Set([
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
]);

const MODES: ReadonlySet<string> = new Set<ConnectorMode>(['REAL', 'SANDBOX', 'SIMULATED']);

export interface SigningRecordRow {
  tenant_id: string;
  signing_record_id: string;
  credential_id: string;
  connector_binding_id: string;
  connector_mode: ConnectorMode;
  simulation_marker: SimulationMarker | null;
  signing_result: 'SIGNED' | 'FAILED';
  signature_ref: string | null;
  signed_artifact_sha256: string | null;
  provider_transaction_ref: string | null;
  failure_code: string | null;
  attempt_number: number;
  idempotency_key: string;
  recorded_at: string;
  correlation_id: string;
}

export type ValidatedSigning = Omit<
  SigningRecordRow,
  | 'tenant_id'
  | 'signing_record_id'
  | 'credential_id'
  | 'attempt_number'
  | 'idempotency_key'
  | 'recorded_at'
  | 'correlation_id'
>;

function invalid(code = 'SIGNING_RESULT_INVALID'): never {
  throw new Cmp022Error('SF-CRED-001', detail(code));
}

function validMarker(
  raw: unknown,
  bindingId: string,
  environment: DeploymentEnvironment,
): SimulationMarker {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid('SIMULATION_MARKER_INVALID');
  }
  const m = raw as Record<string, unknown>;
  const allowed = new Set([
    'simulation',
    'scenario',
    'test_run_id',
    'connector_binding_id',
    'environment',
  ]);
  if (Object.keys(m).some((k) => !allowed.has(k))) invalid('SIMULATION_MARKER_INVALID');
  const testRunId = m['test_run_id'];
  if (
    m['simulation'] !== true ||
    !isScenario(m['scenario']) ||
    typeof testRunId !== 'string' ||
    testRunId.length < 1 ||
    testRunId.length > 128 ||
    m['connector_binding_id'] !== bindingId ||
    m['environment'] !== environment
  ) {
    invalid('SIMULATION_MARKER_INVALID');
  }
  return {
    simulation: true,
    scenario: m['scenario'] as string,
    test_run_id: testRunId,
    connector_binding_id: bindingId,
    environment: environment as SimulationMarker['environment'],
  };
}

/**
 * Validates an INT-013 adapter outcome before it is recorded. Fail closed: SIMULATED outside the
 * simulation environments (UAT, PREPROD, PRODUCTION) is refused and never recorded as SIGNED.
 */
export function validateSigningResult(
  raw: SigningAdapterResult,
  environment: DeploymentEnvironment,
): ValidatedSigning {
  if (raw === null || typeof raw !== 'object') invalid();
  if (raw.integration_contract !== 'INT-013') invalid('SIGNING_CONTRACT_MISMATCH');
  if (typeof raw.connector_binding_id !== 'string' || !isUuid(raw.connector_binding_id)) invalid();
  if (!MODES.has(raw.connector_mode)) invalid();
  const mode = raw.connector_mode;
  let marker: SimulationMarker | null = null;
  if (mode === 'SIMULATED') {
    if (!SIMULATION_ENVIRONMENTS.has(environment)) invalid('SIMULATED_CONNECTOR_FORBIDDEN');
    marker = validMarker(raw.simulation_marker, raw.connector_binding_id, environment);
  } else if (raw.simulation_marker !== undefined) {
    invalid('SIMULATION_MARKER_FORBIDDEN');
  }
  const providerRef = raw.provider_transaction_ref;
  if (providerRef !== undefined && !isOpaqueRef(providerRef, 1, 128)) invalid();
  const base = {
    connector_binding_id: raw.connector_binding_id,
    connector_mode: mode,
    simulation_marker: marker,
    provider_transaction_ref: providerRef ?? null,
  };
  if (raw.signing_result === 'SIGNED') {
    if (!isStorageKey(raw.signature_ref) || !isSha256Hex(raw.signed_artifact_sha256)) invalid();
    if (raw.failure_code !== undefined) invalid();
    return {
      ...base,
      signing_result: 'SIGNED',
      signature_ref: raw.signature_ref,
      signed_artifact_sha256: raw.signed_artifact_sha256,
      failure_code: null,
    };
  }
  if (raw.signing_result === 'FAILED') {
    if (!isErrorCode(raw.failure_code)) invalid();
    if (raw.signature_ref !== undefined || raw.signed_artifact_sha256 !== undefined) invalid();
    return {
      ...base,
      signing_result: 'FAILED',
      signature_ref: null,
      signed_artifact_sha256: null,
      failure_code: raw.failure_code,
    };
  }
  return invalid();
}

/** SF-CON-SIGNING-RECORD v1 (FROZEN) view. */
export function signingRecordView(row: SigningRecordRow): Record<string, unknown> {
  const view: Record<string, unknown> = {
    contract_id: 'SF-CON-SIGNING-RECORD',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    signing_record_id: row.signing_record_id,
    credential_id: row.credential_id,
    connector_binding_id: row.connector_binding_id,
    integration_contract: 'INT-013',
    connector_mode: row.connector_mode,
    signing_result: row.signing_result,
    attempt_number: row.attempt_number,
    idempotency_key: row.idempotency_key,
    retry_safe: true,
    invented_statutory_policy_forbidden: true,
    recorded_at: row.recorded_at,
    correlation_id: row.correlation_id,
  };
  if (row.simulation_marker !== null) view['simulation_marker'] = { ...row.simulation_marker };
  if (row.signature_ref !== null) view['signature_ref'] = row.signature_ref;
  if (row.signed_artifact_sha256 !== null)
    view['signed_artifact_sha256'] = row.signed_artifact_sha256;
  if (row.provider_transaction_ref !== null)
    view['provider_transaction_ref'] = row.provider_transaction_ref;
  if (row.failure_code !== null) view['failure_code'] = row.failure_code;
  return view;
}
