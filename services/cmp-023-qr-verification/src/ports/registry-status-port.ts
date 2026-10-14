/**
 * Read-only view of the CMP-024 registry record (subset of FROZEN SF-CON-CREDENTIAL-STATUS).
 * CMP-024 is the only status authority. This port deliberately exposes a single read: CMP-023
 * has no way to write, suspend, revoke or override a registry status.
 */
export type RegistryStatus = 'REGISTERED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'REISSUED';

export interface RegistryStatusRecord {
  tenant_id: string;
  credential_id: string;
  issuer_ref: string;
  status_authority_cmp: 'CMP-024';
  current_status: RegistryStatus;
  superseded_by_credential_id?: string;
}

export interface RegistryStatusPort {
  getStatus(p: { tenantId: string; credentialId: string }): Promise<RegistryStatusRecord | null>;
}
