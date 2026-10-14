import { createHash } from 'node:crypto';
import { Cmp022Error, detail } from '../errors.js';
import type { ActorType } from '../types.js';

export const LIFECYCLE = ['GENERATED', 'SIGNED', 'ISSUED'] as const;
export type LifecycleStatus = (typeof LIFECYCLE)[number];

export type ArtifactKind = 'UNSIGNED_RENDER' | 'SIGNED_ARTIFACT';

/** Forward-only issuance lifecycle. ISSUED is terminal: no downstream outcome can reverse it. */
const NEXT: Readonly<Record<LifecycleStatus, LifecycleStatus | null>> = {
  GENERATED: 'SIGNED',
  SIGNED: 'ISSUED',
  ISSUED: null,
};

export function assertForwardTransition(from: LifecycleStatus, to: LifecycleStatus): void {
  if (NEXT[from] !== to) {
    throw new Cmp022Error('SF-APP-001', detail('INVALID_CREDENTIAL_TRANSITION'));
  }
}

export interface CredentialRow {
  tenant_id: string;
  credential_id: string;
  application_id: string;
  cell_id: string;
  tenant_service_binding_id: string;
  service_version_id: string;
  credential_template_id: string;
  credential_template_version: number;
  lifecycle_status: LifecycleStatus;
  issuance_key: string;
  idempotency_key: string;
  approval_decision_ref: string;
  signing_record_id: string | null;
  correlation_id: string;
  actor_type: ActorType;
  created_by: string;
  generated_at: string;
  signed_at: string | null;
  issued_at: string | null;
}

export interface ArtifactRow {
  credential_id: string;
  artifact_kind: ArtifactKind;
  storage_key: string;
  sha256: string;
}

/**
 * Deterministic credential id for (tenant, application, issuance_key) so that concurrent or
 * retried issuance requests converge on one credential and one rendered artifact. RFC 9562
 * version-8 layout over SHA-256.
 */
export function credentialIdFor(
  tenantId: string,
  applicationId: string,
  issuanceKey: string,
): string {
  const h = createHash('sha256')
    .update(`cmp022:credential:v1\n${tenantId}\n${applicationId}\n${issuanceKey}`)
    .digest();
  h[6] = ((h[6] as number) & 0x0f) | 0x80;
  h[8] = ((h[8] as number) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const renderKeyFor = (credentialId: string): string => `cmp022.render.${credentialId}`;
export const signingKeyFor = (credentialId: string, attempt: number): string =>
  `cmp022.sign.${credentialId}.${attempt}`;
export const registryKeyFor = (credentialId: string): string => `cmp022.register.${credentialId}`;

const ARTIFACT_ORDER: Readonly<Record<ArtifactKind, number>> = {
  UNSIGNED_RENDER: 0,
  SIGNED_ARTIFACT: 1,
};

/** SF-CON-CREDENTIAL v1 (FROZEN) view. */
export interface CredentialView {
  contract_id: 'SF-CON-CREDENTIAL';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  credential_id: string;
  application_id: string;
  version_pins: { tenant_service_binding_id: string; service_version_id: string };
  template_pin: { credential_template_id: string; credential_template_version: number };
  lifecycle_status: LifecycleStatus;
  artifacts: { artifact_kind: ArtifactKind; storage_key: string; sha256: string }[];
  signing_record_id?: string;
  issuance_key: string;
  idempotency_key: string;
  approval_decision_ref: string;
  approval_decision_by_this_component: false;
  registry_status_owner_cmp: 'CMP-024';
  issued_at?: string;
  issuance_reversible_by_publish_failure: false;
  issuance_reversible_by_notification_failure: false;
  invented_statutory_policy_forbidden: true;
  correlation_id: string;
}

export function credentialView(row: CredentialRow, artifacts: ArtifactRow[]): CredentialView {
  const view: CredentialView = {
    contract_id: 'SF-CON-CREDENTIAL',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    credential_id: row.credential_id,
    application_id: row.application_id,
    version_pins: {
      tenant_service_binding_id: row.tenant_service_binding_id,
      service_version_id: row.service_version_id,
    },
    template_pin: {
      credential_template_id: row.credential_template_id,
      credential_template_version: row.credential_template_version,
    },
    lifecycle_status: row.lifecycle_status,
    artifacts: [...artifacts]
      .sort((a, b) => ARTIFACT_ORDER[a.artifact_kind] - ARTIFACT_ORDER[b.artifact_kind])
      .map((a) => ({
        artifact_kind: a.artifact_kind,
        storage_key: a.storage_key,
        sha256: a.sha256,
      })),
    issuance_key: row.issuance_key,
    idempotency_key: row.idempotency_key,
    approval_decision_ref: row.approval_decision_ref,
    approval_decision_by_this_component: false,
    registry_status_owner_cmp: 'CMP-024',
    issuance_reversible_by_publish_failure: false,
    issuance_reversible_by_notification_failure: false,
    invented_statutory_policy_forbidden: true,
    correlation_id: row.correlation_id,
  };
  if (row.signing_record_id !== null) view.signing_record_id = row.signing_record_id;
  if (row.issued_at !== null) view.issued_at = row.issued_at;
  return view;
}
