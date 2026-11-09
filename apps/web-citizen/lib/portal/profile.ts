import {
  normaliseMobile,
  validateDisplayName,
  validateMobile,
} from '@serviceform/m10-sample-lab/identity-rules';
import type { FormSchemaNode } from '@serviceform/service-templates';
import { platform, type Citizen } from './platform';
import { sampleLab, semanticPointers } from './forms';

/**
 * Citizen BFF → CMP-005 profile and CMP-030 consent (SF-M10-B-2d). Profile claims are read with
 * the citizen's own bearer on every request that needs them and are never written to the cookie
 * (SF-CON-PORTAL-SESSION). Every read and write is gated by CMP-030 consent for the purpose below.
 */
export const PROFILE_PURPOSE =
  process.env['SF_PORTAL_PROFILE_PURPOSE'] ?? 'SAMPLE_LAB_PROFILE_PREFILL';

export interface ProfileClaims {
  display_name?: string;
  mobile?: string;
}

/**
 * Profile claim → canonical semantic element (Constitution §38). Prefill targets fields by the
 * semantic id the published form declares, so no form or service is named here. `synthetic` is the
 * SAMPLE_LAB data gate: in a SAMPLE_LAB placement a value that fails it is never used.
 */
const CLAIMS = [
  {
    key: 'display_name',
    section_code: 'IDENTITY',
    claim_code: 'DISPLAY_NAME',
    semantic: /^SF-SEM-PERSON-FULL-NAME$/,
    synthetic: (v: string) => validateDisplayName(v) === null,
  },
  {
    key: 'mobile',
    section_code: 'IDENTITY',
    claim_code: 'CONTACT_PHONE',
    semantic: /^SF-SEM-PERSON-MOBILE$/,
    synthetic: (v: string) => validateMobile(v) === null,
  },
] as const;

function accept(spec: (typeof CLAIMS)[number], value: string): boolean {
  return value.trim() !== '' && (!sampleLab() || spec.synthetic(value));
}

type ClaimRow = { section_code?: unknown; claim_code?: unknown; value_text?: unknown };

const profilePath = (citizen: Citizen) => `/v1/profiles/${citizen.citizen_id}`;

/** Claims the citizen consented to share for prefill; null when there is no consented profile. */
export async function readProfile(citizen: Citizen): Promise<ProfileClaims | null> {
  const res = await platform(
    'GET',
    `${profilePath(citizen)}?purpose_code=${encodeURIComponent(PROFILE_PURPOSE)}`,
    { token: citizen.token },
  );
  if (res.status !== 200 || !Array.isArray(res.body['claims'])) return null;
  const out: ProfileClaims = {};
  for (const row of res.body['claims'] as ClaimRow[]) {
    const spec = CLAIMS.find(
      (c) => c.section_code === row.section_code && c.claim_code === row.claim_code,
    );
    if (spec && typeof row.value_text === 'string' && accept(spec, row.value_text)) {
      out[spec.key] = row.value_text;
    }
  }
  return out;
}

export type RegistrationStep = 'PROFILE' | 'PURPOSE' | 'CONSENT' | 'CLAIMS';
export type RegistrationResult =
  { ok: true } | { ok: false; step: RegistrationStep; status: number };

/**
 * Registration after a verified OTP: ensure the CMP-005 profile, record the citizen's CMP-030
 * consent for the profile purpose, then store the self-asserted (UNVERIFIED) claims. A consent
 * the citizen already holds is reused.
 */
export async function registerProfile(
  citizen: Citizen,
  input: { display_name: string; mobile: string },
): Promise<RegistrationResult> {
  const token = citizen.token;
  const ensured = await platform('PUT', profilePath(citizen), {
    token,
    body: {},
    idempotent: true,
  });
  if (ensured.status !== 200) return { ok: false, step: 'PROFILE', status: ensured.status };

  const purposes = await platform('GET', '/v1/purposes', { token });
  const purpose = (
    (purposes.body['items'] as { code?: unknown; purpose_id?: unknown; status?: unknown }[]) ?? []
  ).find((p) => p.code === PROFILE_PURPOSE && p.status === 'ACTIVE');
  if (purposes.status !== 200 || typeof purpose?.purpose_id !== 'string') {
    return { ok: false, step: 'PURPOSE', status: purposes.status };
  }

  const consent = await platform('POST', '/v1/consents', {
    token,
    idempotent: true,
    body: {
      subject_id: citizen.citizen_id,
      purpose_id: purpose.purpose_id,
      channel: 'WEB',
      representation_basis: 'SELF',
    },
  });
  const alreadyHeld = consent.status === 409 && consent.body['error_code'] === 'SF-APP-002';
  if (consent.status !== 201 && !alreadyHeld) {
    return { ok: false, step: 'CONSENT', status: consent.status };
  }

  const claims = await platform('PUT', `${profilePath(citizen)}/claims`, {
    token,
    idempotent: true,
    body: {
      purpose_code: PROFILE_PURPOSE,
      claims: [
        { section_code: 'IDENTITY', claim_code: 'DISPLAY_NAME', value_text: input.display_name },
        {
          section_code: 'IDENTITY',
          claim_code: 'CONTACT_PHONE',
          value_text: normaliseMobile(input.mobile),
        },
      ],
    },
  });
  if (claims.status !== 200) return { ok: false, step: 'CLAIMS', status: claims.status };
  return { ok: true };
}

function setPointer(data: Record<string, unknown>, pointer: string, value: string) {
  const parts = pointer.split('/').filter(Boolean);
  const last = parts.pop();
  if (!last) return data;
  const root: Record<string, unknown> = { ...data };
  let cur = root;
  for (const p of parts) {
    const child = cur[p];
    const next =
      typeof child === 'object' && child !== null && !Array.isArray(child)
        ? { ...(child as Record<string, unknown>) }
        : {};
    cur[p] = next;
    cur = next;
  }
  cur[last] = value;
  return root;
}

/** Overlays consented profile claims onto `base` at every field bound to the claim's semantic id. */
export function profilePrefill(
  schema: FormSchemaNode,
  base: Record<string, unknown>,
  claims: ProfileClaims | null,
): Record<string, unknown> {
  if (!claims) return base;
  let out = base;
  for (const spec of CLAIMS) {
    const value = claims[spec.key];
    if (!value || !accept(spec, value)) continue;
    for (const pointer of semanticPointers(schema, spec.semantic)) {
      out = setPointer(out, pointer, value);
    }
  }
  return out;
}
