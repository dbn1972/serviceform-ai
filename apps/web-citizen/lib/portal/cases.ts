import { issuanceApplies, type IssuanceProjection, type PlatformApplication } from './applications';
import { platform, type Citizen, type PlatformResponse } from './platform';

export async function readWorkingData(
  citizen: Citizen,
  applicationId: string,
): Promise<Record<string, unknown> | null> {
  const res = await platform('GET', `/v1/applications/${applicationId}/working-data`, {
    token: citizen.token,
  });
  const wd = res.body['working_data'] as { data?: Record<string, unknown> } | undefined;
  return res.status === 200 && wd?.data ? wd.data : null;
}

export async function command(
  citizen: Citizen,
  app: PlatformApplication,
  name: string,
  idempotencyKey?: string,
): Promise<{ ok: true; app: PlatformApplication } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', `/v1/applications/${app.application_id}/commands`, {
    token: citizen.token,
    ...(idempotencyKey ? { idempotencyKey } : { idempotent: true }),
    body: { command: name, expected_state: app.state, expected_version: app.aggregate_version },
  });
  const next = res.body['application'] as PlatformApplication | undefined;
  return res.status === 200 && next ? { ok: true, app: next } : { ok: false, res };
}

/**
 * Credential and DigiLocker status for a case past approval. The host authorizes the citizen on
 * CMP-015 first; any refusal or outage reads as "not requested" rather than failing the page.
 */
export async function readIssuance(
  citizen: Citizen,
  app: PlatformApplication,
): Promise<IssuanceProjection | null> {
  if (!issuanceApplies(app.state)) return null;
  const res = await platform('GET', `/v1/applications/${app.application_id}/issuance`, {
    token: citizen.token,
  });
  return res.status === 200 ? (res.body as unknown as IssuanceProjection) : null;
}
