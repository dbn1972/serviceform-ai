/**
 * SAMPLE_LAB assisted-service apply shell helpers (SF-54 / Constitution #36).
 * Client-safe pure functions — no Node / platform imports.
 * CERTIFIED=false · G6=false.
 */

import {
  SAMPLE_LAB_ASSISTED_CHANNELS,
  SAMPLE_LAB_ASSISTED_CONSENT,
  SAMPLE_LAB_ASSISTED_ASSURANCE,
  channelRequiresAuthority,
  isSampleLabAssistedChannel,
} from '@serviceform/m10-sample-lab/assisted-catalogue';

export {
  SAMPLE_LAB_ASSISTED_CHANNELS,
  SAMPLE_LAB_ASSISTED_CONSENT,
  SAMPLE_LAB_ASSISTED_ASSURANCE,
  channelRequiresAuthority,
  isSampleLabAssistedChannel,
};

export interface AssistedSessionDoc {
  session_id: string;
  channel: string;
  applied_by_actor_id: string;
  applied_for_citizen_id: string;
  applied_by_distinct_from_applied_for: true;
  lifecycle_status: string;
  representation_authority_ref?: string | null;
}

export interface AssistedSessionView {
  session_id: string;
  channel: string;
  applied_by_actor_id: string;
  applied_for_citizen_id: string;
  applied_by_distinct_from_applied_for: true;
  lifecycle_status: string;
  session_version: number;
  application_id: string | null;
  consent_ref: string | null;
  representation_authority_ref: string | null;
  can_bind: boolean;
  can_capture_consent: boolean;
  can_verify: boolean;
  can_apply: boolean;
  can_close: boolean;
  impersonation: false;
}

export function toAssistedSessionView(
  body: Record<string, unknown>,
): AssistedSessionView | null {
  const session = body['assisted_session'];
  if (!session || typeof session !== 'object') return null;
  const s = session as Record<string, unknown>;
  const status = String(s['lifecycle_status'] ?? '');
  const proof =
    body['proof'] && typeof body['proof'] === 'object'
      ? (body['proof'] as Record<string, unknown>)
      : {};
  return {
    session_id: String(s['session_id'] ?? ''),
    channel: String(s['channel'] ?? ''),
    applied_by_actor_id: String(s['applied_by_actor_id'] ?? ''),
    applied_for_citizen_id: String(s['applied_for_citizen_id'] ?? ''),
    applied_by_distinct_from_applied_for: true,
    lifecycle_status: status,
    session_version: typeof body['session_version'] === 'number' ? body['session_version'] : 0,
    application_id: typeof body['application_id'] === 'string' ? body['application_id'] : null,
    consent_ref: typeof proof['consent_ref'] === 'string' ? proof['consent_ref'] : null,
    representation_authority_ref:
      typeof s['representation_authority_ref'] === 'string'
        ? s['representation_authority_ref']
        : null,
    can_bind: status === 'STARTED',
    can_capture_consent: status === 'APPLICANT_BOUND' || status === 'STARTED',
    can_verify: status === 'APPLICANT_BOUND',
    can_apply: status === 'REPRESENTATION_VERIFIED',
    can_close: status !== 'CLOSED' && status !== 'SUBMITTED',
    impersonation: false,
  };
}

/** Fail-closed consent gate for the UI / BFF before calling VERIFY_REPRESENTATION. */
export function consentGate(input: {
  read_back_acknowledged: unknown;
  consent_ref: unknown;
  applied_by_actor_id: string;
  applied_for_citizen_id: string;
}): { ok: true; consent_ref: string } | { ok: false; code: string; message: string } {
  if (
    input.applied_by_actor_id.toLowerCase() === input.applied_for_citizen_id.toLowerCase()
  ) {
    return {
      ok: false,
      code: 'APPLIED_BY_EQUALS_APPLIED_FOR',
      message: 'Operator must not equal the citizen (Constitution #36 — no impersonation)',
    };
  }
  if (input.read_back_acknowledged !== true) {
    return {
      ok: false,
      code: 'READ_BACK_ACKNOWLEDGEMENT_REQUIRED',
      message: 'Consent is fail-closed: citizen read-back must be acknowledged',
    };
  }
  if (typeof input.consent_ref !== 'string' || input.consent_ref.length < 8) {
    return {
      ok: false,
      code: 'CONSENT_REF_REQUIRED',
      message: 'consent_ref is required',
    };
  }
  return { ok: true, consent_ref: input.consent_ref };
}

export function representationGate(input: {
  channel: string;
  representation_authority_ref: unknown;
}): { ok: true; representation_authority_ref: string | null } | { ok: false; code: string; message: string } {
  if (channelRequiresAuthority(input.channel)) {
    if (
      typeof input.representation_authority_ref !== 'string' ||
      input.representation_authority_ref.length < 3
    ) {
      return {
        ok: false,
        code: 'REPRESENTATION_AUTHORITY_REF_REQUIRED',
        message: 'This channel requires an opaque representation authority ref (no statute invented)',
      };
    }
    return { ok: true, representation_authority_ref: input.representation_authority_ref };
  }
  return {
    ok: true,
    representation_authority_ref:
      typeof input.representation_authority_ref === 'string'
        ? input.representation_authority_ref
        : null,
  };
}
