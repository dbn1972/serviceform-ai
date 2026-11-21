import {
  toHelpdeskTicket,
  type PlatformGrievance,
} from '../../../../lib/portal/grievances';
import { currentOfficer, json, platform, relay } from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Helpdesk queue — CMP-027 lab list filtered by optional role_code desk. */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const url = new URL(request.url);
  const role = url.searchParams.get('role_code');
  const qs = new URLSearchParams({ limit: '100' });
  if (role && /^[A-Z][A-Z0-9_]{1,63}$/.test(role)) qs.set('role_code', role);
  const res = await platform('GET', `/v1/lab/grievances/queue?${qs}`, {
    token: officer.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const rows = (res.body['grievances'] ?? []) as PlatformGrievance[];
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    grievances: rows.map((g) => toHelpdeskTicket(g)),
  });
}
