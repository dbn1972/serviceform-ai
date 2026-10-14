import { createHash, randomBytes } from 'node:crypto';
import type { IssuedCredentialView } from '../ports/credential-port.js';
import type { RegistryStatus, RegistryStatusRecord } from '../ports/registry-status-port.js';
import type { ActorType } from '../types.js';
import { isUuid } from './uuid.js';

export const CONTRACT_ID = 'SF-CON-VERIFICATION-TOKEN';
export const CONTRACT_STATUS = 'FROZEN';
export const TOKEN_PURPOSE = 'PUBLIC_CREDENTIAL_VERIFICATION';
export const STATUS_SOURCE_CMP = 'CMP-024';

export const REGISTRY_STATUSES: readonly RegistryStatus[] = [
  'REGISTERED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'REISSUED',
];

/** 32 random bytes, base64url: 43 characters, carries nothing about the credential or holder. */
export const TOKEN_BYTES = 32;
export const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{22,256}$/;
export const REF = /^[A-Za-z0-9_.:-]{1,128}$/;
export const SHA256_HEX = /^[a-f0-9]{64}$/;

/** The only keys public_view may carry (frozen schema, additionalProperties false). */
export const PUBLIC_VIEW_KEYS = [
  'credential_type_ref',
  'issuer_ref',
  'issued_at',
  'registry_status',
  'status_checked_at',
  'signed_artifact_sha256',
] as const;

export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function isOpaqueToken(v: unknown): v is string {
  return typeof v === 'string' && OPAQUE_TOKEN.test(v);
}

export function isRef(v: unknown): v is string {
  return typeof v === 'string' && REF.test(v);
}

/** Non-reversible handle used in audit so the bearer token itself is never logged. */
export function tokenRef(opaque: string): string {
  return `token-ref:${createHash('sha256').update(opaque).digest('hex').slice(0, 32)}`;
}

export interface VerificationTokenRecord {
  tenant_id: string;
  token_id: string;
  credential_id: string;
  opaque_token: string;
  credential_type_ref: string;
  issuer_ref: string;
  issued_at: string | null;
  signed_artifact_sha256: string | null;
  expires_at: string | null;
  actor_type: ActorType;
  actor_id: string;
  created_at: string;
  correlation_id: string;
}

export interface PublicView {
  credential_type_ref: string;
  issuer_ref: string;
  issued_at?: string;
  registry_status: RegistryStatus;
  status_checked_at: string;
  signed_artifact_sha256?: string;
}

export interface VerificationTokenContract {
  contract_id: typeof CONTRACT_ID;
  contract_status: typeof CONTRACT_STATUS;
  freeze_status: typeof CONTRACT_STATUS;
  tenant_id: string;
  token_id: string;
  credential_id: string;
  opaque_token: string;
  token_purpose: typeof TOKEN_PURPOSE;
  public_view: PublicView;
  status_source_cmp: typeof STATUS_SOURCE_CMP;
  registry_status_read_only: true;
  status_write_forbidden: true;
  embedded_pii_forbidden: true;
  expires_at?: string;
  correlation_id: string;
}

/**
 * Builds the purpose-minimised view from fixed fields only. registry_status is always the value
 * just read from CMP-024; the token record has no status of its own to fall back to.
 */
export function buildPublicView(
  row: VerificationTokenRecord,
  status: RegistryStatus,
  checkedAt: Date,
): PublicView {
  const view: PublicView = {
    credential_type_ref: row.credential_type_ref,
    issuer_ref: row.issuer_ref,
    registry_status: status,
    status_checked_at: checkedAt.toISOString(),
  };
  if (row.issued_at !== null) view.issued_at = row.issued_at;
  if (row.signed_artifact_sha256 !== null) view.signed_artifact_sha256 = row.signed_artifact_sha256;
  return view;
}

export function buildVerificationToken(
  row: VerificationTokenRecord,
  status: RegistryStatus,
  checkedAt: Date,
): VerificationTokenContract {
  const token: VerificationTokenContract = {
    contract_id: CONTRACT_ID,
    contract_status: CONTRACT_STATUS,
    freeze_status: CONTRACT_STATUS,
    tenant_id: row.tenant_id,
    token_id: row.token_id,
    credential_id: row.credential_id,
    opaque_token: row.opaque_token,
    token_purpose: TOKEN_PURPOSE,
    public_view: buildPublicView(row, status, checkedAt),
    status_source_cmp: STATUS_SOURCE_CMP,
    registry_status_read_only: true,
    status_write_forbidden: true,
    embedded_pii_forbidden: true,
    correlation_id: row.correlation_id,
  };
  if (row.expires_at !== null) token.expires_at = row.expires_at;
  return token;
}

export function isExpired(row: VerificationTokenRecord, now: Date): boolean {
  return row.expires_at !== null && Date.parse(row.expires_at) <= now.getTime();
}

export function isRegistryStatusRecord(v: unknown): v is RegistryStatusRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<RegistryStatusRecord>;
  return (
    typeof r.tenant_id === 'string' &&
    typeof r.credential_id === 'string' &&
    isUuid(r.credential_id) &&
    isRef(r.issuer_ref) &&
    r.status_authority_cmp === STATUS_SOURCE_CMP &&
    REGISTRY_STATUSES.includes(r.current_status as RegistryStatus)
  );
}

export function isCredentialView(v: unknown): v is IssuedCredentialView {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<IssuedCredentialView>;
  return (
    typeof c.tenant_id === 'string' &&
    typeof c.credential_id === 'string' &&
    isUuid(c.credential_id) &&
    (c.lifecycle_status === 'GENERATED' ||
      c.lifecycle_status === 'SIGNED' ||
      c.lifecycle_status === 'ISSUED') &&
    (c.issued_at === undefined || !Number.isNaN(Date.parse(c.issued_at))) &&
    Array.isArray(c.artifacts) &&
    c.artifacts.every(
      (a) =>
        (a?.artifact_kind === 'UNSIGNED_RENDER' || a?.artifact_kind === 'SIGNED_ARTIFACT') &&
        typeof a.sha256 === 'string' &&
        SHA256_HEX.test(a.sha256),
    )
  );
}

export function signedArtifactHash(c: IssuedCredentialView): string | null {
  return c.artifacts.find((a) => a.artifact_kind === 'SIGNED_ARTIFACT')?.sha256 ?? null;
}
