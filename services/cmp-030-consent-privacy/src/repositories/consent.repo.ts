import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Cmp030Error } from '../errors.js';

export interface PurposeRow {
  tenant_id: string;
  purpose_id: string;
  code: string;
  label: string;
  status: 'ACTIVE' | 'RETIRED';
  requires_consent: boolean;
  version: string;
  created_at: Date;
  updated_at: Date;
}

export interface NoticeRow {
  tenant_id: string;
  notice_id: string;
  purpose_id: string;
  version_no: string;
  content_ref: string;
  status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  published_at: Date | null;
  created_at: Date;
}

export interface ConsentRow {
  tenant_id: string;
  consent_id: string;
  subject_id: string;
  purpose_id: string;
  notice_id: string | null;
  status: 'GRANTED' | 'WITHDRAWN';
  granted_at: Date;
  withdrawn_at: Date | null;
  applied_by: string;
  applied_for: string;
  representation_basis: 'SELF' | 'ASSISTED' | 'LEGAL_REP';
  channel: 'WEB' | 'COUNTER' | 'API';
  version: string;
}

export async function insertPurpose(
  client: PoolClient,
  params: {
    tenantId: string;
    code: string;
    label: string;
    requiresConsent: boolean;
    createdBy: string;
  },
): Promise<PurposeRow> {
  const purposeId = randomUUID();
  const res = await client.query<PurposeRow>(
    `INSERT INTO sf_consent_privacy.purpose (
       tenant_id, purpose_id, code, label, status, requires_consent, created_by
     ) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6)
     RETURNING tenant_id, purpose_id, code, label, status, requires_consent, version, created_at, updated_at`,
    [
      params.tenantId,
      purposeId,
      params.code,
      params.label,
      params.requiresConsent,
      params.createdBy,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Cmp030Error('SF-SYS-001');
  return row;
}

export async function listPurposes(client: PoolClient, tenantId: string): Promise<PurposeRow[]> {
  const res = await client.query<PurposeRow>(
    `SELECT tenant_id, purpose_id, code, label, status, requires_consent, version, created_at, updated_at
       FROM sf_consent_privacy.purpose
      WHERE tenant_id = $1
      ORDER BY code`,
    [tenantId],
  );
  return res.rows;
}

export async function getPurposeById(
  client: PoolClient,
  tenantId: string,
  purposeId: string,
): Promise<PurposeRow | null> {
  const res = await client.query<PurposeRow>(
    `SELECT tenant_id, purpose_id, code, label, status, requires_consent, version, created_at, updated_at
       FROM sf_consent_privacy.purpose
      WHERE tenant_id = $1 AND purpose_id = $2`,
    [tenantId, purposeId],
  );
  return res.rows[0] ?? null;
}

export async function getPurposeByCode(
  client: PoolClient,
  tenantId: string,
  code: string,
): Promise<PurposeRow | null> {
  const res = await client.query<PurposeRow>(
    `SELECT tenant_id, purpose_id, code, label, status, requires_consent, version, created_at, updated_at
       FROM sf_consent_privacy.purpose
      WHERE tenant_id = $1 AND code = $2`,
    [tenantId, code],
  );
  return res.rows[0] ?? null;
}

export async function insertNotice(
  client: PoolClient,
  params: {
    tenantId: string;
    purposeId: string;
    contentRef: string;
    versionNo: number;
    createdBy: string;
  },
): Promise<NoticeRow> {
  const noticeId = randomUUID();
  const res = await client.query<NoticeRow>(
    `INSERT INTO sf_consent_privacy.privacy_notice (
       tenant_id, notice_id, purpose_id, version_no, content_ref, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,'DRAFT',$6)
     RETURNING tenant_id, notice_id, purpose_id, version_no, content_ref, status, published_at, created_at`,
    [
      params.tenantId,
      noticeId,
      params.purposeId,
      params.versionNo,
      params.contentRef,
      params.createdBy,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Cmp030Error('SF-SYS-001');
  return row;
}

export async function publishNotice(
  client: PoolClient,
  params: { tenantId: string; noticeId: string; now: Date },
): Promise<NoticeRow> {
  await client.query(
    `UPDATE sf_consent_privacy.privacy_notice
        SET status = 'SUPERSEDED'
      WHERE tenant_id = $1
        AND purpose_id = (
          SELECT purpose_id FROM sf_consent_privacy.privacy_notice
           WHERE tenant_id = $1 AND notice_id = $2
        )
        AND status = 'PUBLISHED'`,
    [params.tenantId, params.noticeId],
  );
  const res = await client.query<NoticeRow>(
    `UPDATE sf_consent_privacy.privacy_notice
        SET status = 'PUBLISHED', published_at = $3
      WHERE tenant_id = $1 AND notice_id = $2 AND status = 'DRAFT'
      RETURNING tenant_id, notice_id, purpose_id, version_no, content_ref, status, published_at, created_at`,
    [params.tenantId, params.noticeId, params.now.toISOString()],
  );
  const row = res.rows[0];
  if (!row) throw new Cmp030Error('SF-SYS-002');
  return row;
}

export async function getNotice(
  client: PoolClient,
  tenantId: string,
  noticeId: string,
): Promise<NoticeRow | null> {
  const res = await client.query<NoticeRow>(
    `SELECT tenant_id, notice_id, purpose_id, version_no, content_ref, status, published_at, created_at
       FROM sf_consent_privacy.privacy_notice
      WHERE tenant_id = $1 AND notice_id = $2`,
    [tenantId, noticeId],
  );
  return res.rows[0] ?? null;
}

export async function insertConsent(
  client: PoolClient,
  params: {
    tenantId: string;
    subjectId: string;
    purposeId: string;
    noticeId: string | null;
    appliedBy: string;
    appliedFor: string;
    representationBasis: 'SELF' | 'ASSISTED' | 'LEGAL_REP';
    channel: 'WEB' | 'COUNTER' | 'API';
    now: Date;
  },
): Promise<ConsentRow> {
  const consentId = randomUUID();
  const res = await client.query<ConsentRow>(
    `INSERT INTO sf_consent_privacy.consent (
       tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
       applied_by, applied_for, representation_basis, channel
     ) VALUES ($1,$2,$3,$4,$5,'GRANTED',$6,$7,$8,$9,$10)
     RETURNING tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
               withdrawn_at, applied_by, applied_for, representation_basis, channel, version`,
    [
      params.tenantId,
      consentId,
      params.subjectId,
      params.purposeId,
      params.noticeId,
      params.now.toISOString(),
      params.appliedBy,
      params.appliedFor,
      params.representationBasis,
      params.channel,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Cmp030Error('SF-SYS-001');
  return row;
}

export async function insertConsentEvent(
  client: PoolClient,
  params: {
    tenantId: string;
    consentId: string;
    eventType: 'GRANTED' | 'WITHDRAWN';
    occurredAt: Date;
    actorId: string;
    correlationId: string;
    noticeId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sf_consent_privacy.consent_event (
       tenant_id, event_id, consent_id, event_type, occurred_at, actor_id, correlation_id, notice_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      params.tenantId,
      randomUUID(),
      params.consentId,
      params.eventType,
      params.occurredAt.toISOString(),
      params.actorId,
      params.correlationId,
      params.noticeId,
    ],
  );
}

export async function getConsent(
  client: PoolClient,
  tenantId: string,
  consentId: string,
): Promise<ConsentRow | null> {
  const res = await client.query<ConsentRow>(
    `SELECT tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
            withdrawn_at, applied_by, applied_for, representation_basis, channel, version
       FROM sf_consent_privacy.consent
      WHERE tenant_id = $1 AND consent_id = $2`,
    [tenantId, consentId],
  );
  return res.rows[0] ?? null;
}

export async function listConsents(
  client: PoolClient,
  params: { tenantId: string; subjectId: string; purposeId?: string },
): Promise<ConsentRow[]> {
  if (params.purposeId) {
    const res = await client.query<ConsentRow>(
      `SELECT tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
              withdrawn_at, applied_by, applied_for, representation_basis, channel, version
         FROM sf_consent_privacy.consent
        WHERE tenant_id = $1 AND subject_id = $2 AND purpose_id = $3
        ORDER BY granted_at DESC`,
      [params.tenantId, params.subjectId, params.purposeId],
    );
    return res.rows;
  }
  const res = await client.query<ConsentRow>(
    `SELECT tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
            withdrawn_at, applied_by, applied_for, representation_basis, channel, version
       FROM sf_consent_privacy.consent
      WHERE tenant_id = $1 AND subject_id = $2
      ORDER BY granted_at DESC`,
    [params.tenantId, params.subjectId],
  );
  return res.rows;
}

export async function getActiveConsent(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  purposeId: string,
): Promise<ConsentRow | null> {
  const res = await client.query<ConsentRow>(
    `SELECT tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
            withdrawn_at, applied_by, applied_for, representation_basis, channel, version
       FROM sf_consent_privacy.consent
      WHERE tenant_id = $1 AND subject_id = $2 AND purpose_id = $3 AND status = 'GRANTED'`,
    [tenantId, subjectId, purposeId],
  );
  return res.rows[0] ?? null;
}

export async function getLatestConsent(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  purposeId: string,
): Promise<ConsentRow | null> {
  const res = await client.query<ConsentRow>(
    `SELECT tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
            withdrawn_at, applied_by, applied_for, representation_basis, channel, version
       FROM sf_consent_privacy.consent
      WHERE tenant_id = $1 AND subject_id = $2 AND purpose_id = $3
      ORDER BY granted_at DESC
      LIMIT 1`,
    [tenantId, subjectId, purposeId],
  );
  return res.rows[0] ?? null;
}

export async function withdrawConsent(
  client: PoolClient,
  params: { tenantId: string; consentId: string; now: Date },
): Promise<ConsentRow> {
  const existing = await getConsent(client, params.tenantId, params.consentId);
  if (!existing) throw new Cmp030Error('SF-SYS-002');
  if (existing.status === 'WITHDRAWN') return existing;
  const res = await client.query<ConsentRow>(
    `UPDATE sf_consent_privacy.consent
        SET status = 'WITHDRAWN', withdrawn_at = $3, version = version + 1
      WHERE tenant_id = $1 AND consent_id = $2 AND status = 'GRANTED'
      RETURNING tenant_id, consent_id, subject_id, purpose_id, notice_id, status, granted_at,
                withdrawn_at, applied_by, applied_for, representation_basis, channel, version`,
    [params.tenantId, params.consentId, params.now.toISOString()],
  );
  const row = res.rows[0];
  if (!row) throw new Cmp030Error('SF-SYS-002');
  return row;
}

export function serializeConsent(row: ConsentRow) {
  return {
    consent_id: row.consent_id,
    tenant_id: row.tenant_id,
    subject_id: row.subject_id,
    purpose_id: row.purpose_id,
    notice_id: row.notice_id,
    status: row.status,
    granted_at: row.granted_at.toISOString(),
    withdrawn_at: row.withdrawn_at ? row.withdrawn_at.toISOString() : null,
    applied_by: row.applied_by,
    applied_for: row.applied_for,
    representation_basis: row.representation_basis,
    channel: row.channel,
    version: Number(row.version),
  };
}

export function serializePurpose(row: PurposeRow) {
  return {
    purpose_id: row.purpose_id,
    tenant_id: row.tenant_id,
    code: row.code,
    label: row.label,
    status: row.status,
    requires_consent: row.requires_consent,
    version: Number(row.version),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function serializeNotice(row: NoticeRow) {
  return {
    notice_id: row.notice_id,
    tenant_id: row.tenant_id,
    purpose_id: row.purpose_id,
    version_no: Number(row.version_no),
    content_ref: row.content_ref,
    status: row.status,
    published_at: row.published_at ? row.published_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}
