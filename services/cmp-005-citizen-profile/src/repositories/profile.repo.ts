import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Cmp005Error } from '../errors.js';
import type { SourceKind, VerificationStatus } from '../domain/provenance.js';

export interface ProfileRow {
  tenant_id: string;
  profile_id: string;
  subject_id: string;
  status: string;
  version: string;
}

export interface ClaimRow {
  tenant_id: string;
  claim_id: string;
  profile_id: string;
  subject_id: string;
  section_code: string;
  claim_code: string;
  value_sha256: string;
  value_text: string;
  source_kind: SourceKind;
  connector_type: string | null;
  verification_status: VerificationStatus;
  purpose_code: string;
  source_ref: string | null;
  verified_at: Date | null;
  expires_at: Date | null;
  simulation: unknown;
  version: string;
}

export async function definitionExists(
  client: PoolClient,
  section: string,
  code: string,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM sf_citizen_profile.claim_definition
      WHERE section_code = $1 AND claim_code = $2`,
    [section, code],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getProfile(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
): Promise<ProfileRow | null> {
  const res = await client.query<ProfileRow>(
    `SELECT tenant_id, profile_id, subject_id, status, version
       FROM sf_citizen_profile.citizen_profile
      WHERE tenant_id = $1 AND subject_id = $2`,
    [tenantId, subjectId],
  );
  return res.rows[0] ?? null;
}

export async function ensureProfile(
  client: PoolClient,
  params: { tenantId: string; subjectId: string; actorId: string; now: Date },
): Promise<ProfileRow> {
  const existing = await getProfile(client, params.tenantId, params.subjectId);
  if (existing) return existing;
  const profileId = randomUUID();
  const res = await client.query<ProfileRow>(
    `INSERT INTO sf_citizen_profile.citizen_profile (
       tenant_id, profile_id, subject_id, status, created_by, updated_at
     ) VALUES ($1,$2,$3,'ACTIVE',$4,$5)
     ON CONFLICT (tenant_id, subject_id) DO NOTHING
     RETURNING tenant_id, profile_id, subject_id, status, version`,
    [params.tenantId, profileId, params.subjectId, params.actorId, params.now.toISOString()],
  );
  if (res.rows[0]) return res.rows[0];
  const again = await getProfile(client, params.tenantId, params.subjectId);
  if (!again) throw new Cmp005Error('SF-SYS-001');
  return again;
}

export async function listClaims(
  client: PoolClient,
  tenantId: string,
  profileId: string,
): Promise<ClaimRow[]> {
  const res = await client.query<ClaimRow>(
    `SELECT tenant_id, claim_id, profile_id, subject_id, section_code, claim_code,
            value_sha256, value_text, source_kind, connector_type, verification_status,
            purpose_code, source_ref, verified_at, expires_at, simulation, version
       FROM sf_citizen_profile.profile_claim
      WHERE tenant_id = $1 AND profile_id = $2
      ORDER BY section_code, claim_code`,
    [tenantId, profileId],
  );
  return res.rows;
}

export async function getClaim(
  client: PoolClient,
  tenantId: string,
  profileId: string,
  section: string,
  code: string,
): Promise<ClaimRow | null> {
  const res = await client.query<ClaimRow>(
    `SELECT tenant_id, claim_id, profile_id, subject_id, section_code, claim_code,
            value_sha256, value_text, source_kind, connector_type, verification_status,
            purpose_code, source_ref, verified_at, expires_at, simulation, version
       FROM sf_citizen_profile.profile_claim
      WHERE tenant_id = $1 AND profile_id = $2 AND section_code = $3 AND claim_code = $4`,
    [tenantId, profileId, section, code],
  );
  return res.rows[0] ?? null;
}

export async function insertClaim(
  client: PoolClient,
  params: {
    tenantId: string;
    profileId: string;
    subjectId: string;
    section: string;
    code: string;
    valueSha: string;
    valueText: string;
    sourceKind: SourceKind;
    connectorType: string | null;
    verification: VerificationStatus;
    purposeCode: string;
    sourceRef: string | null;
    verifiedAt: Date | null;
    simulation: unknown;
    now: Date;
  },
): Promise<ClaimRow> {
  const res = await client.query<ClaimRow>(
    `INSERT INTO sf_citizen_profile.profile_claim (
       tenant_id, claim_id, profile_id, subject_id, section_code, claim_code,
       value_sha256, value_text, source_kind, connector_type, verification_status,
       purpose_code, source_ref, verified_at, simulation, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
     RETURNING tenant_id, claim_id, profile_id, subject_id, section_code, claim_code,
               value_sha256, value_text, source_kind, connector_type, verification_status,
               purpose_code, source_ref, verified_at, expires_at, simulation, version`,
    [
      params.tenantId,
      randomUUID(),
      params.profileId,
      params.subjectId,
      params.section,
      params.code,
      params.valueSha,
      params.valueText,
      params.sourceKind,
      params.connectorType,
      params.verification,
      params.purposeCode,
      params.sourceRef,
      params.verifiedAt?.toISOString() ?? null,
      params.simulation === null || params.simulation === undefined
        ? null
        : JSON.stringify(params.simulation),
      params.now.toISOString(),
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Cmp005Error('SF-SYS-001');
  return row;
}

export async function updateClaim(
  client: PoolClient,
  params: {
    tenantId: string;
    claimId: string;
    valueSha: string;
    valueText: string;
    sourceKind: SourceKind;
    connectorType: string | null;
    verification: VerificationStatus;
    purposeCode: string;
    sourceRef: string | null;
    verifiedAt: Date | null;
    simulation: unknown;
    now: Date;
  },
): Promise<ClaimRow> {
  const res = await client.query<ClaimRow>(
    `UPDATE sf_citizen_profile.profile_claim
        SET value_sha256 = $1,
            value_text = $2,
            source_kind = $3,
            connector_type = $4,
            verification_status = $5,
            purpose_code = $6,
            source_ref = $7,
            verified_at = $8,
            simulation = $9::jsonb,
            version = version + 1,
            updated_at = $10
      WHERE tenant_id = $11 AND claim_id = $12
      RETURNING tenant_id, claim_id, profile_id, subject_id, section_code, claim_code,
                value_sha256, value_text, source_kind, connector_type, verification_status,
                purpose_code, source_ref, verified_at, expires_at, simulation, version`,
    [
      params.valueSha,
      params.valueText,
      params.sourceKind,
      params.connectorType,
      params.verification,
      params.purposeCode,
      params.sourceRef,
      params.verifiedAt?.toISOString() ?? null,
      params.simulation === null || params.simulation === undefined
        ? null
        : JSON.stringify(params.simulation),
      params.now.toISOString(),
      params.tenantId,
      params.claimId,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Cmp005Error('SF-SYS-002');
  return row;
}

export function serializeProfile(profile: ProfileRow, claims: ClaimRow[], includeValues: boolean) {
  return {
    profile_id: profile.profile_id,
    subject_id: profile.subject_id,
    status: profile.status,
    version: Number(profile.version),
    claims: claims.map((c) => {
      const out: Record<string, unknown> = {
        claim_id: c.claim_id,
        section_code: c.section_code,
        claim_code: c.claim_code,
        value_sha256: c.value_sha256,
        source_kind: c.source_kind,
        verification_status: c.verification_status,
        purpose_code: c.purpose_code,
        version: Number(c.version),
      };
      if (c.connector_type) out.connector_type = c.connector_type;
      if (includeValues) out.value_text = c.value_text;
      return out;
    }),
  };
}
