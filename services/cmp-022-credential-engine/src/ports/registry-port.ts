import { Cmp022Error, detail } from '../errors.js';
import type { TenantContext } from '../types.js';

export interface RegistrationRequest {
  credential_id: string;
  application_id: string;
  signed_artifact_sha256: string;
  /** Stable per credential so a retried registration is a no-op at CMP-024. */
  idempotency_key: string;
}

/** Subset of SF-CON-CREDENTIAL-STATUS returned by CMP-024 on registration. */
export interface RegistrationAck {
  credential_id: string;
  current_status: 'REGISTERED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'REISSUED';
}

/** CMP-024 is the only registry-status authority; CMP-022 never writes or caches status. */
export interface CredentialRegistryPort {
  register(ctx: TenantContext, req: RegistrationRequest): Promise<RegistrationAck>;
}

export class UnboundCredentialRegistryPort implements CredentialRegistryPort {
  register(): Promise<RegistrationAck> {
    return Promise.reject(new Cmp022Error('SF-SYS-004', detail('REGISTRY_PORT_NOT_BOUND')));
  }
}
