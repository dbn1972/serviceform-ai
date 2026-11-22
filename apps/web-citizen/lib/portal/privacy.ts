import {
  SAMPLE_LAB_PRIVACY_REQUEST_TYPES,
  SAMPLE_LAB_PRIVACY_RETENTION,
  SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES,
  isSampleLabPrivacyRequestType,
  privacyRequestTypeLabel,
  scopeTemplateLabel,
  type SampleLabPrivacyRequestType,
} from '@serviceform/m10-sample-lab/privacy-catalogue';

export interface PlatformPrivacyRequest {
  request_id: string;
  request_type: string;
  lifecycle_status: string;
  /** Present on full records; CMP-061 list/contract views may omit it. */
  scope_count?: number;
  submit_assurance?: string;
  created_at?: string;
  updated_at?: string;
  request_version?: number;
}

export interface PlatformConsent {
  consent_id: string;
  subject_id: string;
  purpose_id: string;
  status: string;
  granted_at: string;
  withdrawn_at: string | null;
  representation_basis: string;
  channel: string;
}

export interface PlatformPurpose {
  purpose_id: string;
  code: string;
  label: string;
  status: string;
  requires_consent: boolean;
}

export interface PortalPrivacyRequest {
  request_id: string;
  request_type: string;
  request_type_label: string;
  lifecycle_status: string;
  status_label: string;
  scope_count: number;
  created_at: string | null;
  updated_at: string | null;
  can_withdraw: boolean;
}

export interface PortalConsent {
  consent_id: string;
  purpose_id: string;
  purpose_code: string | null;
  purpose_label: string | null;
  status: string;
  status_label: string;
  granted_at: string;
  withdrawn_at: string | null;
  representation_basis: string;
  channel: string;
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  TASKS_REQUESTED: 'Owner tasks requested',
  COMPLETED: 'Completed',
  WITHDRAWN: 'Withdrawn',
  DENIED_WITH_BASIS_REF: 'Denied (owner basis ref)',
  GRANTED: 'Granted',
  WITHDRAWN_CONSENT: 'Withdrawn',
};

export function toPortalPrivacyRequest(
  row: PlatformPrivacyRequest,
  opts: { scopeCount?: number } = {},
): PortalPrivacyRequest {
  const status = row.lifecycle_status;
  return {
    request_id: row.request_id,
    request_type: row.request_type,
    request_type_label: privacyRequestTypeLabel(row.request_type) ?? row.request_type,
    lifecycle_status: status,
    status_label: STATUS_LABELS[status] ?? status,
    scope_count: opts.scopeCount ?? row.scope_count ?? 0,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    can_withdraw: status === 'SUBMITTED' || status === 'TASKS_REQUESTED',
  };
}

export function toPortalConsent(
  c: PlatformConsent,
  purposesById: Map<string, PlatformPurpose>,
): PortalConsent {
  const purpose = purposesById.get(c.purpose_id);
  return {
    consent_id: c.consent_id,
    purpose_id: c.purpose_id,
    purpose_code: purpose?.code ?? null,
    purpose_label: purpose?.label ?? null,
    status: c.status,
    status_label: c.status === 'WITHDRAWN' ? 'Withdrawn' : (STATUS_LABELS[c.status] ?? c.status),
    granted_at: c.granted_at,
    withdrawn_at: c.withdrawn_at,
    representation_basis: c.representation_basis,
    channel: c.channel,
  };
}

export function parseRequestType(value: unknown): SampleLabPrivacyRequestType | null {
  return isSampleLabPrivacyRequestType(value) ? value : null;
}

/** Validate scope against published SAMPLE_LAB templates (opaque refs only). */
export function parseScope(
  value: unknown,
): { owner_component: string; scope_ref: string }[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: { owner_component: string; scope_ref: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    const owner = rec['owner_component'];
    const scopeRef = rec['scope_ref'];
    if (typeof owner !== 'string' || typeof scopeRef !== 'string') return null;
    const allowed = SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES.some(
      (t) => t.owner_component === owner && t.scope_ref === scopeRef,
    );
    if (!allowed) return null;
    out.push({ owner_component: owner, scope_ref: scopeRef });
  }
  return out;
}

export function mapAssurance(assurance: string): 'OTP' | 'PASSWORD' | 'MFA' {
  if (assurance === 'MFA' || assurance === 'PASSWORD' || assurance === 'OTP') return assurance;
  return 'OTP';
}

export {
  SAMPLE_LAB_PRIVACY_REQUEST_TYPES,
  SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES,
  SAMPLE_LAB_PRIVACY_RETENTION,
  scopeTemplateLabel,
};
