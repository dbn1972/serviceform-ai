/**
 * Read-only view of a CMP-022 issuance record (subset of FROZEN SF-CON-CREDENTIAL). Used only to
 * confirm the credential is ISSUED and to take its issued_at and signed artifact hash. Holder or
 * application data is never requested.
 */
export interface CredentialArtifactRef {
  artifact_kind: 'UNSIGNED_RENDER' | 'SIGNED_ARTIFACT';
  sha256: string;
}

export interface IssuedCredentialView {
  tenant_id: string;
  credential_id: string;
  lifecycle_status: 'GENERATED' | 'SIGNED' | 'ISSUED';
  issued_at?: string;
  artifacts: CredentialArtifactRef[];
}

export interface CredentialPort {
  getCredential(p: { tenantId: string; credentialId: string }): Promise<IssuedCredentialView | null>;
}
