import { Cmp022Error, detail } from '../errors.js';
import type { TenantContext } from '../types.js';

export type ConnectorMode = 'REAL' | 'SANDBOX' | 'SIMULATED';

export interface SimulationMarker {
  simulation: true;
  scenario: string;
  test_run_id: string;
  connector_binding_id: string;
  environment: 'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'PERFORMANCE';
}

export interface SigningRequest {
  credential_id: string;
  artifact: { storage_key: string; sha256: string };
  attempt_number: number;
  /** Deterministic per (credential, attempt); the adapter returns the same result on replay. */
  idempotency_key: string;
}

/**
 * Adapter outcome from the CMP-037 signing connector (INT-013). The connector binding, and so the
 * mode, is resolved by CMP-037 from tenant metadata; the caller never selects it. Signer
 * eligibility, certificate class and eSign policy are connector-binding metadata, not CMP-022.
 */
export interface SigningAdapterResult {
  connector_binding_id: string;
  integration_contract: 'INT-013';
  connector_mode: ConnectorMode;
  simulation_marker?: SimulationMarker;
  signing_result: 'SIGNED' | 'FAILED';
  signature_ref?: string;
  signed_artifact_sha256?: string;
  provider_transaction_ref?: string;
  failure_code?: string;
}

export interface SigningPort {
  sign(ctx: TenantContext, req: SigningRequest): Promise<SigningAdapterResult>;
}

export class UnboundSigningPort implements SigningPort {
  sign(): Promise<SigningAdapterResult> {
    return Promise.reject(new Cmp022Error('SF-SYS-004', detail('SIGNING_PORT_NOT_BOUND')));
  }
}
