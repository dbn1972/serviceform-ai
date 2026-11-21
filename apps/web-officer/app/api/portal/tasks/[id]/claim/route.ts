import { claimTask } from '../../../../../../lib/portal/tasks';
import {
  currentOfficer,
  isUuid,
  json,
  relay,
  crossSiteRefusal,
} from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** CMP-017 claim — exclusive work on a HUMAN_TASK for the officer's matching role_code. */
export async function POST(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const outcome = await claimTask(officer, id);
  if (!outcome.ok) return relay(outcome.res);
  return json(200, { task: outcome.task, source: 'PLATFORM' });
}
