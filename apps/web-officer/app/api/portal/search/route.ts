import { buildSearchBody, toSearchHitCard, type PlatformSearchHit } from '../../../../lib/portal/search';
import {
  crossSiteRefusal,
  currentOfficer,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CMP-035 case search — opaque facets only; never authoritative. */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });

  // Ensure lab projections exist (fail-soft).
  await platform('POST', '/v1/lab/m08/ensure', { token: officer.token, from: request }).catch(
    () => undefined,
  );

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const queryInput: {
    catalogue_id?: string;
    case_state?: string;
    application_ref?: string;
    limit?: number;
  } = {};
  if (typeof body?.['catalogue_id'] === 'string') queryInput.catalogue_id = body['catalogue_id'];
  if (typeof body?.['case_state'] === 'string') queryInput.case_state = body['case_state'];
  if (typeof body?.['application_ref'] === 'string') {
    queryInput.application_ref = body['application_ref'];
  }
  if (typeof body?.['limit'] === 'number') queryInput.limit = body['limit'];
  const query = buildSearchBody(queryInput);

  const res = await platform('POST', '/v1/search/queries', {
    token: officer.token,
    from: request,
    body: query,
  });
  if (res.status !== 200) return relay(res);
  const hits = (res.body['hits'] ?? []) as PlatformSearchHit[];
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    non_authoritative: true,
    hits: hits.map(toSearchHitCard),
    next_cursor: res.body['next_cursor'] ?? null,
  });
}
