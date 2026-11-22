import {
  SAMPLE_LAB_PRIVACY_REQUEST_TYPES,
  SAMPLE_LAB_PRIVACY_RETENTION,
  SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES,
  mapAssurance,
  parseRequestType,
  parseScope,
  toPortalConsent,
  toPortalPrivacyRequest,
  type PlatformConsent,
  type PlatformPrivacyRequest,
  type PlatformPurpose,
} from '../../../../lib/portal/privacy';
import {
  crossSiteRefusal,
  currentCitizen,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN = 'Sign in with your mobile number to continue';

/**
 * Citizen privacy centre summary:
 * CMP-061 /privacy/me + CMP-030 consents/purposes + SAMPLE_LAB retention posture catalogue.
 */
export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });

  const [me, consents, purposes, catalogue] = await Promise.all([
    platform('GET', '/v1/privacy/me', { token: citizen.token, from: request }),
    platform('GET', `/v1/consents?subject_id=${encodeURIComponent(citizen.citizen_id)}`, {
      token: citizen.token,
      from: request,
    }),
    platform('GET', '/v1/purposes', { token: citizen.token, from: request }),
    platform('GET', '/v1/lab/privacy/catalogue', { token: citizen.token, from: request }),
  ]);

  if (me.status === 401 || me.status === 403) return relay(me);
  if (me.status !== 200) return relay(me, 'Unable to load privacy centre');

  const purposeItems = (
    purposes.status === 200
      ? ((purposes.body['items'] ?? purposes.body) as
          PlatformPurpose[] | { items?: PlatformPurpose[] })
      : []
  ) as PlatformPurpose[] | { items?: PlatformPurpose[] };
  const purposeList: PlatformPurpose[] = Array.isArray(purposeItems)
    ? purposeItems
    : Array.isArray(purposeItems.items)
      ? purposeItems.items
      : [];
  const purposesById = new Map(purposeList.map((p) => [p.purpose_id, p]));

  const consentItems =
    consents.status === 200
      ? ((consents.body['items'] ?? []) as PlatformConsent[])
      : ([] as PlatformConsent[]);

  const requestRows = (me.body['requests'] ?? []) as PlatformPrivacyRequest[];
  const retention =
    catalogue.status === 200 && catalogue.body['catalogue']
      ? ((catalogue.body['catalogue'] as { retention?: unknown }).retention ??
        SAMPLE_LAB_PRIVACY_RETENTION)
      : SAMPLE_LAB_PRIVACY_RETENTION;

  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    invented_statutory_policy_forbidden: true,
    subject_actor_id: me.body['subject_actor_id'] ?? citizen.citizen_id,
    purposes: purposeList.map((p) => ({
      purpose_id: p.purpose_id,
      code: p.code,
      label: p.label,
      status: p.status,
      requires_consent: p.requires_consent,
    })),
    consents: consentItems.map((c) => toPortalConsent(c, purposesById)),
    requests: requestRows.map((row) => toPortalPrivacyRequest(row)),
    request_types: SAMPLE_LAB_PRIVACY_REQUEST_TYPES,
    scope_templates: SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES,
    retention,
    consent_list_status: consents.status,
    purpose_list_status: purposes.status,
    catalogue_status: catalogue.status,
  });
}

/** Submit a CMP-061 privacy rights request (opaque scope templates only). */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const requestType = parseRequestType(body?.['request_type']);
  const scope = parseScope(body?.['scope']);
  if (!requestType) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Choose a published privacy request type',
    });
  }
  if (!scope) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Choose at least one published scope template',
    });
  }

  const res = await platform('POST', '/v1/privacy/requests', {
    token: citizen.token,
    from: request,
    idempotent: true,
    body: {
      request_type: requestType,
      submit_assurance: mapAssurance(citizen.assurance),
      scope,
    },
  });
  if (res.status !== 201) return relay(res, 'Could not submit privacy request');
  const requestRow = (res.body['request'] ?? res.body) as PlatformPrivacyRequest;
  const scopeOut = (res.body['scope'] ?? scope) as unknown[];
  return json(201, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    request: toPortalPrivacyRequest(requestRow, { scopeCount: scopeOut.length }),
    scope: scopeOut,
    tasks: res.body['tasks'] ?? [],
  });
}
