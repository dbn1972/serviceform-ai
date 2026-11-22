import {
  toOpenSearchCard,
  type PlatformOpenSearchStatus,
} from '../../../../../lib/portal/opensearch';
import { currentOfficer, json, platform, relay } from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SIMULATED OpenSearch mirror status — REAL deferred; never authoritative. */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });

  await platform('POST', '/v1/lab/m08/ensure', { token: officer.token, from: request }).catch(
    () => undefined,
  );
  await platform('POST', '/v1/lab/m08/opensearch/sync', {
    token: officer.token,
    from: request,
  }).catch(() => undefined);

  const res = await platform('GET', '/v1/lab/m08/opensearch', {
    token: officer.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const status = res.body as unknown as PlatformOpenSearchStatus;
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    real_opensearch_deferred: true,
    mirror: toOpenSearchCard(status),
    raw: {
      mode: status.mode,
      document_count: status.document_count,
      last_sync_at: status.last_sync_at,
      topic: status.topic ?? null,
      simulator_version: status.simulator_version ?? null,
      opensearch_connector_type_in_contract: status.opensearch_connector_type_in_contract ?? false,
    },
  });
}
