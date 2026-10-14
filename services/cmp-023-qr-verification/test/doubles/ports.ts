import type { CredentialPort, IssuedCredentialView } from '../../src/ports/credential-port.js';
import type {
  RegistryStatus,
  RegistryStatusPort,
  RegistryStatusRecord,
} from '../../src/ports/registry-status-port.js';
import type { QrRepository } from '../../src/repo/types.js';
import {
  CRED_1,
  CRED_2,
  CRED_B1,
  CRED_DRAFT,
  ISSUED_AT,
  ISSUER_REF,
  ISSUER_REF_B,
  SIGNED_SHA,
  TENANT_A,
  TENANT_B,
} from './fixtures.js';

/** Records whether any port call ran while a DB transaction was open. */
export class TxProbe {
  repo: QrRepository | undefined;
  violations = 0;
  check(): void {
    if (this.repo?.inTransaction()) this.violations += 1;
  }
}

/**
 * Fake CMP-024. Keyed by tenant|credential, mirrors the real registry's tenant scoping. It has no
 * method CMP-023 could call to change a status; tests change it directly, as CMP-024 would.
 */
export class FakeRegistry implements RegistryStatusPort {
  readonly records = new Map<string, RegistryStatusRecord>();
  calls = 0;
  fail = false;
  respondWith: unknown = undefined;
  constructor(private readonly probe: TxProbe) {
    this.put(TENANT_A, CRED_1, 'ACTIVE', ISSUER_REF);
    this.put(TENANT_A, CRED_2, 'ACTIVE', ISSUER_REF);
    this.put(TENANT_B, CRED_B1, 'ACTIVE', ISSUER_REF_B);
  }

  put(tenantId: string, credentialId: string, status: RegistryStatus, issuerRef: string): void {
    this.records.set(`${tenantId}|${credentialId}`, {
      tenant_id: tenantId,
      credential_id: credentialId,
      issuer_ref: issuerRef,
      status_authority_cmp: 'CMP-024',
      current_status: status,
    });
  }

  setStatus(tenantId: string, credentialId: string, status: RegistryStatus): void {
    const r = this.records.get(`${tenantId}|${credentialId}`);
    if (r) r.current_status = status;
  }

  getStatus(p: { tenantId: string; credentialId: string }): Promise<RegistryStatusRecord | null> {
    this.probe.check();
    this.calls += 1;
    if (this.fail) return Promise.reject(new Error('registry down'));
    if (this.respondWith !== undefined) {
      return Promise.resolve(structuredClone(this.respondWith) as RegistryStatusRecord);
    }
    const r = this.records.get(`${p.tenantId}|${p.credentialId}`);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
}

export class FakeCredentials implements CredentialPort {
  readonly records = new Map<string, IssuedCredentialView>();
  fail = false;
  respondWith: unknown = undefined;
  constructor(private readonly probe: TxProbe) {
    for (const [tenant, id] of [
      [TENANT_A, CRED_1],
      [TENANT_A, CRED_2],
      [TENANT_B, CRED_B1],
    ] as const) {
      this.records.set(`${tenant}|${id}`, {
        tenant_id: tenant,
        credential_id: id,
        lifecycle_status: 'ISSUED',
        issued_at: ISSUED_AT,
        artifacts: [
          { artifact_kind: 'UNSIGNED_RENDER', sha256: 'a'.repeat(64) },
          { artifact_kind: 'SIGNED_ARTIFACT', sha256: SIGNED_SHA },
        ],
      });
    }
    this.records.set(`${TENANT_A}|${CRED_DRAFT}`, {
      tenant_id: TENANT_A,
      credential_id: CRED_DRAFT,
      lifecycle_status: 'SIGNED',
      artifacts: [{ artifact_kind: 'SIGNED_ARTIFACT', sha256: SIGNED_SHA }],
    });
  }

  getCredential(p: {
    tenantId: string;
    credentialId: string;
  }): Promise<IssuedCredentialView | null> {
    this.probe.check();
    if (this.fail) return Promise.reject(new Error('credential engine down'));
    if (this.respondWith !== undefined) {
      return Promise.resolve(structuredClone(this.respondWith) as IssuedCredentialView);
    }
    const r = this.records.get(`${p.tenantId}|${p.credentialId}`);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
}
