import { toOpsViewCard, type PlatformOpsView } from '../../../../lib/portal/ops';
import { currentOfficer, json, platform, relay } from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CMP-046 ops views — non-authoritative aggregates only. */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });

  await platform('POST', '/v1/lab/m08/ensure', { token: officer.token, from: request }).catch(
    () => undefined,
  );

  // Seed derived snapshots so first open is not all NEVER_REFRESHED.
  for (const code of [
    'SLA_SUMMARY',
    'QUEUE_SUMMARY',
    'INTEGRATION_HEALTH',
    'EVENT_HEALTH',
    'PLATFORM_HEALTH',
  ]) {
    await platform('POST', `/v1/ops/views/${code}/refresh`, {
      token: officer.token,
      from: request,
      idempotent: true,
      body: {},
    }).catch(() => undefined);
  }

  const list = await platform('GET', '/v1/ops/views', { token: officer.token, from: request });
  if (list.status !== 200) return relay(list);
  const views = (Array.isArray(list.body['views']) ? list.body['views'] : []) as PlatformOpsView[];

  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    non_authoritative: true,
    overall_status: list.body['overall_status'] ?? null,
    views: views.map(toOpsViewCard),
  });
}
