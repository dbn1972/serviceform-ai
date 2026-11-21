import { loadCaseSla } from '../../../../../../lib/portal/sla';
import { currentOfficer, isUuid, json, relay } from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Officer/admin case SLA projection (CMP-029). Fail-closed OPA · CERTIFIED=false. */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const loaded = await loadCaseSla(officer, id);
  if (!loaded.ok) return relay(loaded.res);
  return json(200, {
    ...loaded.projection,
    source: 'PLATFORM',
  });
}
