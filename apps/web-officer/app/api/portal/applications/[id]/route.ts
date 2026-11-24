import {
  decide,
  issuanceApplies,
  readIssuance,
  readWorkingData,
  requestIssuance,
  toWorkbenchApplication,
  type IssuanceProjection,
  type PlatformApplication,
} from '../../../../../lib/portal/cases';
import { claimTask, listAvailableTasks } from '../../../../../lib/portal/tasks';
import {
  currentOfficer,
  isUuid,
  json,
  platform,
  relay,
  crossSiteRefusal,
  tenantIdentifyingRefusal,
} from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function load(token: string, id: string) {
  const res = await platform('GET', `/v1/applications/${id}`, { token });
  return { res, app: res.body['application'] as PlatformApplication | undefined };
}

async function openTaskForApplication(
  officer: Parameters<typeof listAvailableTasks>[0],
  applicationId: string,
) {
  const listed = await listAvailableTasks(officer);
  if (!listed.ok) return null;
  return listed.tasks.find((t) => t.application_id === applicationId) ?? null;
}

export async function GET(request: Request, ctx: Ctx) {
  const tenancy = tenantIdentifyingRefusal(request);
  if (tenancy) return tenancy;
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const { res, app } = await load(officer.token, id);
  if (res.status !== 200 || !app) return relay(res);
  const task = await openTaskForApplication(officer, id);
  return json(200, {
    application: toWorkbenchApplication(
      app,
      await readWorkingData(officer, id),
      await readIssuance(officer, app),
    ),
    task,
    source: 'PLATFORM',
  });
}

/**
 * Human decision on CMP-015 (`APPROVE` | `REJECT` | `FORWARD`) and optional CMP-017 claim.
 * FORWARD is the scrutiny-desk outcome that leaves the case at DECISION_PENDING for the approving
 * desk. After APPROVE the platform issues and publishes (SIMULATED); `ISSUE` retries that.
 */
export async function POST(request: Request, ctx: Ctx) {
  const tenancy = tenantIdentifyingRefusal(request);
  if (tenancy) return tenancy;
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    task_id?: unknown;
  } | null;
  const action = body?.action;
  if (action !== 'APPROVE' && action !== 'REJECT' && action !== 'ISSUE' && action !== 'FORWARD') {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'action must be APPROVE, REJECT, FORWARD or ISSUE',
    });
  }
  const { res, app } = await load(officer.token, id);
  if (res.status !== 200 || !app) return relay(res);

  if (typeof body?.task_id === 'string' && isUuid(body.task_id) && action !== 'ISSUE') {
    const claimed = await claimTask(officer, body.task_id);
    if (!claimed.ok && claimed.res.status !== 409) return relay(claimed.res);
  }

  let decided = app;
  if (action === 'ISSUE') {
    if (!issuanceApplies(app.state)) {
      return json(409, { error_code: 'SF-APP-001', message: 'This case has no recorded approval' });
    }
  } else {
    const outcome = await decide(officer, app, action);
    if (!outcome.ok) return relay(outcome.res);
    decided = outcome.app;
  }
  let issuance: IssuanceProjection | null = null;
  if (action === 'APPROVE' || action === 'ISSUE') {
    const run = await requestIssuance(officer, decided);
    issuance = run.ok
      ? run.issuance
      : {
          case_state: decided.state,
          credential: null,
          digilocker: { mode: 'SIMULATED', status: 'NOT_REQUESTED' },
          issuance_error: {
            error_code:
              typeof run.res.body['error_code'] === 'string'
                ? run.res.body['error_code']
                : 'SF-SYS-004',
            step: 'REQUEST',
          },
        };
    const latest = await load(officer.token, id);
    if (latest.res.status === 200 && latest.app) decided = latest.app;
  }
  return json(200, {
    application: toWorkbenchApplication(decided, await readWorkingData(officer, id), issuance),
    task: await openTaskForApplication(officer, id),
    source: 'PLATFORM',
  });
}
