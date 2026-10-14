import { Cmp012Error, detail } from '../errors.js';

/**
 * CMP-022 port: verify that a credential exists, belongs to the expected tenant,
 * has been signed, and is in lifecycle status ISSUED before DigiLocker publish.
 *
 * All failures are fail-closed (SF-CON-DIGILOCKER-PUBLISH, F01/SEC-F06).
 */
export interface CredentialVerification {
  found: boolean;
  tenantId: string | null;
  /** Credential lifecycle state as held by CMP-022. */
  lifecycle: string | null;
  /** True when the credential payload has a non-empty digital signature. */
  signed: boolean;
}

export interface CredentialVerificationPort {
  verify(tenantId: string, credentialId: string): Promise<CredentialVerification>;
}

/**
 * Guard: throws appropriate Cmp012Error when the verification result does not
 * allow a publish to proceed. All non-ISSUED/unsigned/wrong-tenant states are
 * rejected fail-closed; no silent fallback.
 */
export function assertCredentialIssuedForPublish(
  result: CredentialVerification,
  expectedTenantId: string,
): void {
  if (!result.found) {
    throw new Cmp012Error('SF-SYS-002', detail('CREDENTIAL_NOT_FOUND'));
  }
  if (result.tenantId !== expectedTenantId) {
    throw new Cmp012Error('SF-TEN-002');
  }
  if (!result.signed) {
    throw new Cmp012Error('SF-SYS-003', detail('CREDENTIAL_NOT_SIGNED'));
  }
  if (result.lifecycle !== 'ISSUED') {
    throw new Cmp012Error('SF-SYS-003', detail('CREDENTIAL_NOT_ISSUED'));
  }
}

/** Unbound stub — wired at composition root. */
export class UnboundCredentialVerificationPort implements CredentialVerificationPort {
  verify(): Promise<CredentialVerification> {
    throw new Cmp012Error('SF-SYS-001', detail('CREDENTIAL_VERIFICATION_PORT_UNBOUND'));
  }
}
