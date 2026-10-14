import { describe, expect, it } from 'vitest';
import {
  buildPublicView,
  buildVerificationToken,
  generateOpaqueToken,
  isCredentialView,
  isExpired,
  isOpaqueToken,
  isRegistryStatusRecord,
  PUBLIC_VIEW_KEYS,
  signedArtifactHash,
  tokenRef,
  type VerificationTokenRecord,
} from '../../src/domain/token.js';
import { Cmp023Error } from '../../src/errors.js';
import { validateIssueToken, validateOpaqueToken } from '../../src/service/input.js';
import { CRED_1, ISSUED_AT, ISSUER_REF, OFFICER_1, SIGNED_SHA, TENANT_A, TYPE_REF } from '../doubles/fixtures.js';

const row: VerificationTokenRecord = {
  tenant_id: TENANT_A,
  token_id: 'c1111111-1111-4111-8111-111111111111',
  credential_id: CRED_1,
  opaque_token: 'A'.repeat(43),
  credential_type_ref: TYPE_REF,
  issuer_ref: ISSUER_REF,
  issued_at: ISSUED_AT,
  signed_artifact_sha256: SIGNED_SHA,
  expires_at: null,
  actor_type: 'OFFICER',
  actor_id: OFFICER_1,
  created_at: '2026-10-14T10:00:00.000Z',
  correlation_id: '77777777-7777-4777-8777-777777777777',
};

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof Cmp023Error ? (e.details?.[0]?.code ?? e.code) : 'other';
  }
}

describe('opaque token', () => {
  it('is 43 URL-safe characters, unique and satisfies the frozen pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const t = generateOpaqueToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isOpaqueToken(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it('does not encode the credential, tenant or any input', () => {
    const t = generateOpaqueToken();
    const decoded = Buffer.from(t, 'base64url').toString('latin1');
    for (const id of [CRED_1, TENANT_A, CRED_1.replaceAll('-', '')]) {
      expect(t).not.toContain(id);
      expect(decoded).not.toContain(id);
    }
  });

  it('token-ref is one-way and never contains the token', () => {
    const t = generateOpaqueToken();
    const ref = tokenRef(t);
    expect(ref).toMatch(/^token-ref:[0-9a-f]{32}$/);
    expect(ref).not.toContain(t);
    expect(tokenRef(t)).toBe(ref);
  });

  it('format guard rejects short, long and non URL-safe tokens', () => {
    for (const bad of ['short', 'a'.repeat(21), 'a'.repeat(257), `${'a'.repeat(30)}/x`, `${'a'.repeat(30)}=`]) {
      expect(code(() => validateOpaqueToken(bad))).toBe('TOKEN_FORMAT_INVALID');
    }
    expect(validateOpaqueToken('a'.repeat(22))).toBe('a'.repeat(22));
  });
});

describe('purpose-minimised public view', () => {
  it('carries only the frozen public keys and the status passed in', () => {
    const v = buildPublicView(row, 'REVOKED', new Date('2026-10-15T09:00:00Z'));
    expect(Object.keys(v).every((k) => (PUBLIC_VIEW_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(v.registry_status).toBe('REVOKED');
    expect(v.status_checked_at).toBe('2026-10-15T09:00:00.000Z');
    expect(JSON.stringify(v)).not.toContain(CRED_1);
    expect(JSON.stringify(v)).not.toContain(TENANT_A);
    expect(JSON.stringify(v)).not.toContain(row.opaque_token);
  });

  it('optional facts are omitted rather than null', () => {
    const v = buildPublicView({ ...row, issued_at: null, signed_artifact_sha256: null }, 'ACTIVE', new Date());
    expect('issued_at' in v).toBe(false);
    expect('signed_artifact_sha256' in v).toBe(false);
  });

  it('contract markers are constant and the token record has no status of its own', () => {
    const t = buildVerificationToken(row, 'SUSPENDED', new Date());
    expect(t.registry_status_read_only).toBe(true);
    expect(t.status_write_forbidden).toBe(true);
    expect(t.embedded_pii_forbidden).toBe(true);
    expect(t.status_source_cmp).toBe('CMP-024');
    expect(t.public_view.registry_status).toBe('SUSPENDED');
    expect(Object.keys(row).some((k) => k.includes('status'))).toBe(false);
  });

  it('expiry only applies when an expires_at was supplied', () => {
    const now = new Date('2026-10-14T10:00:00Z');
    expect(isExpired(row, now)).toBe(false);
    expect(isExpired({ ...row, expires_at: '2026-10-14T10:00:00.000Z' }, now)).toBe(true);
    expect(isExpired({ ...row, expires_at: '2026-10-14T10:00:01.000Z' }, now)).toBe(false);
  });
});

describe('port response guards', () => {
  const reg = {
    tenant_id: TENANT_A,
    credential_id: CRED_1,
    issuer_ref: ISSUER_REF,
    status_authority_cmp: 'CMP-024',
    current_status: 'ACTIVE',
  };
  it('registry record must come from CMP-024 with a known status', () => {
    expect(isRegistryStatusRecord(reg)).toBe(true);
    expect(isRegistryStatusRecord({ ...reg, status_authority_cmp: 'CMP-023' })).toBe(false);
    expect(isRegistryStatusRecord({ ...reg, current_status: 'VALID' })).toBe(false);
    expect(isRegistryStatusRecord({ ...reg, issuer_ref: 'Some Official Name' })).toBe(false);
    expect(isRegistryStatusRecord(null)).toBe(false);
  });

  it('credential view requires a known lifecycle and hex artifact hashes', () => {
    const c = {
      tenant_id: TENANT_A,
      credential_id: CRED_1,
      lifecycle_status: 'ISSUED',
      issued_at: ISSUED_AT,
      artifacts: [{ artifact_kind: 'SIGNED_ARTIFACT', sha256: SIGNED_SHA }],
    };
    expect(isCredentialView(c)).toBe(true);
    expect(signedArtifactHash(c as never)).toBe(SIGNED_SHA);
    expect(isCredentialView({ ...c, lifecycle_status: 'APPROVED' })).toBe(false);
    expect(isCredentialView({ ...c, artifacts: [{ artifact_kind: 'SIGNED_ARTIFACT', sha256: 'zz' }] })).toBe(false);
    expect(signedArtifactHash({ ...c, artifacts: [] } as never)).toBeNull();
  });
});

describe('issue input', () => {
  it('accepts credential id, type ref, optional expiry and echoed markers', () => {
    const v = validateIssueToken({
      credential_id: CRED_1.toUpperCase(),
      credential_type_ref: TYPE_REF,
      expires_at: '2027-01-01T00:00:00+05:30',
      registry_status_read_only: true,
      token_purpose: 'PUBLIC_CREDENTIAL_VERIFICATION',
    });
    expect(v).toEqual({
      credential_id: CRED_1,
      credential_type_ref: TYPE_REF,
      expires_at: '2026-12-31T18:30:00.000Z',
    });
  });

  it('refuses any attempt to supply a registry status or public view', () => {
    for (const key of ['registry_status', 'current_status', 'status', 'public_view']) {
      expect(code(() => validateIssueToken({ ...{ credential_id: CRED_1, credential_type_ref: TYPE_REF }, [key]: 'ACTIVE' }))).toBe(
        'STATUS_WRITE_FORBIDDEN',
      );
    }
  });

  it('refuses server-owned facts, unknown (PII-shaped) fields, tenant and client time', () => {
    const base = { credential_id: CRED_1, credential_type_ref: TYPE_REF };
    expect(code(() => validateIssueToken({ ...base, issuer_ref: ISSUER_REF }))).toBe('SERVER_OWNED_FIELD');
    expect(code(() => validateIssueToken({ ...base, opaque_token: 'a'.repeat(43) }))).toBe('SERVER_OWNED_FIELD');
    expect(code(() => validateIssueToken({ ...base, holder_name: 'SYNTHETIC' }))).toBe('UNKNOWN_FIELD');
    expect(code(() => validateIssueToken({ ...base, tenant_id: TENANT_A }))).toBe('TENANT_ID_SERVER_DERIVED');
    expect(code(() => validateIssueToken({ ...base, created_at: ISSUED_AT }))).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');
  });

  it('refuses flipped markers, malformed ids, refs and timestamps', () => {
    const base = { credential_id: CRED_1, credential_type_ref: TYPE_REF };
    expect(code(() => validateIssueToken({ ...base, status_write_forbidden: false }))).toBe('CONSTANT_MARKER_MISMATCH');
    expect(code(() => validateIssueToken({ ...base, embedded_pii_forbidden: false }))).toBe('CONSTANT_MARKER_MISMATCH');
    expect(code(() => validateIssueToken({ ...base, status_source_cmp: 'CMP-023' }))).toBe('CONSTANT_MARKER_MISMATCH');
    expect(code(() => validateIssueToken({ ...base, credential_id: 'nope' }))).toBe('UUID_REQUIRED');
    expect(code(() => validateIssueToken({ ...base, credential_type_ref: 'has space' }))).toBe('REF_INVALID');
    expect(code(() => validateIssueToken({ ...base, expires_at: '2027-01-01' }))).toBe('TIMESTAMP_INVALID');
    expect(code(() => validateIssueToken([]))).toBe('OBJECT_REQUIRED');
  });
});
