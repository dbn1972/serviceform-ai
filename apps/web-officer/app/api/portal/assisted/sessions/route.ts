import { randomUUID } from 'node:crypto';
import {
  json,
  platform,
  currentOfficer,
  relay,
  crossSiteRefusal,
  isUuid,
} from '../../../../../lib/portal/platform';
import { isSampleLabAssistedChannel } from '../../../../../lib/portal/assisted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start assisted session. applied_by is always the authenticated officer (server-derived);
 * body must not supply applied_by. Constitution #36 — no impersonation.
 */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return json(400, { error_code: 'SF-SYS-003', message: 'JSON body required' });
  }
  if ('applied_by' in body || 'applied_by_actor_id' in body) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'applied_by is server-owned from the officer session (never client-supplied)',
      details: [{ code: 'SERVER_OWNED_FIELD' }],
    });
  }
  const channel = typeof body['channel'] === 'string' ? body['channel'] : 'CSC';
  if (!isSampleLabAssistedChannel(channel)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Unknown assisted channel' });
  }
  const appliedFor = body['applied_for_citizen_id'];
  if (!isUuid(appliedFor)) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'applied_for_citizen_id must be a citizen UUID',
    });
  }
  if (appliedFor.toLowerCase() === officer.officer_id.toLowerCase()) {
    return json(403, {
      error_code: 'SF-AUTH-002',
      message: 'applied_by must be distinct from applied_for (Constitution #36)',
      details: [{ code: 'APPLIED_BY_EQUALS_APPLIED_FOR' }],
      certified: false,
      g6_issued: false,
    });
  }
  const res = await platform('POST', '/v1/assisted/sessions', {
    token: officer.token,
    from: request,
    idempotent: true,
    body: { channel, applied_for_citizen_id: appliedFor },
  });
  if (res.status !== 201 && res.status !== 200) return relay(res);
  return json(res.status, {
    ...res.body,
    proof_note: 'Operator remains applied_by; citizen remains applied_for; no impersonation',
    certified: false,
    g6_issued: false,
    correlation_seed: randomUUID(),
  });
}
