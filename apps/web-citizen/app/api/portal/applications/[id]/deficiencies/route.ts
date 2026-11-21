import {
  activeOpenNotice,
  listDeficiencies,
  respondToDeficiency,
} from '../../../../../../lib/portal/deficiency';
import {
  toPortalApplication,
  type PlatformApplication,
} from '../../../../../../lib/portal/applications';
import { catalogueIdForCase } from '../../../../../../lib/portal/catalogue-resolve';
import { readIssuance, readWorkingData } from '../../../../../../lib/portal/cases';
import {
  crossSiteRefusal,
  currentCitizen,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function loadApp(token: string, id: string) {
  const res = await platform('GET', `/v1/applications/${id}`, { token });
  return { res, app: res.body['application'] as PlatformApplication | undefined };
}

/** Deficiencies for this application (OPA + RLS). Open notice drives ACTION_REQUIRED UI. */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) {
    return json(404, { error_code: 'SF-SYS-002', message: 'We could not find this application.' });
  }
  const { res, app } = await loadApp(citizen.token, id);
  if (res.status === 403 || res.status === 404) {
    return json(404, { error_code: 'SF-SYS-002', message: 'We could not find this application.' });
  }
  if (res.status !== 200 || !app) return relay(res);
  const listed = await listDeficiencies(citizen, id);
  if (!listed.ok) return relay(listed.res);
  return json(200, {
    deficiencies: listed.deficiencies,
    open_deficiency: activeOpenNotice(listed.deficiencies) ?? null,
    application: toPortalApplication(
      app,
      await readWorkingData(citizen, id),
      await readIssuance(citizen, app),
      catalogueIdForCase(app),
    ),
    source: 'PLATFORM',
    certified: false,
    g6_issued: false,
  });
}

/** Citizen response to an OPEN deficiency (CMP-013 AVAILABLE document_id required). */
export async function POST(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { id } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) {
    return json(404, { error_code: 'SF-SYS-002', message: 'We could not find this application.' });
  }
  const body = (await request.json().catch(() => null)) as {
    deficiency_id?: unknown;
    narrative?: unknown;
    provided_item_codes?: unknown;
    document_id?: unknown;
  } | null;
  if (!body || typeof body.deficiency_id !== 'string' || !isUuid(body.deficiency_id)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'deficiency_id is required' });
  }
  if (typeof body.narrative !== 'string' || body.narrative.trim().length < 3) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Please describe how you are responding (at least a few words)',
    });
  }
  if (!Array.isArray(body.provided_item_codes) || body.provided_item_codes.length < 1) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Select at least one requested item you are providing',
    });
  }
  if (typeof body.document_id !== 'string' || !isUuid(body.document_id)) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Upload a supporting document (CMP-013) before you respond',
    });
  }
  const codes = body.provided_item_codes.filter((c): c is string => typeof c === 'string');

  const { res, app } = await loadApp(citizen.token, id);
  if (res.status === 403 || res.status === 404) {
    return json(404, { error_code: 'SF-SYS-002', message: 'We could not find this application.' });
  }
  if (res.status !== 200 || !app) return relay(res);
  if (app.state !== 'DEFICIENCY_RAISED') {
    return json(409, {
      error_code: 'SF-APP-001',
      message: 'This application is not waiting for a deficiency response',
    });
  }

  const listed = await listDeficiencies(citizen, id);
  if (!listed.ok) return relay(listed.res);
  const open = listed.deficiencies.find(
    (d) => d.deficiency_id === body.deficiency_id && d.status === 'OPEN',
  );
  if (!open) {
    return json(404, {
      error_code: 'SF-SYS-002',
      message: 'There is no open deficiency notice for this application',
    });
  }
  const known = new Set(open.items.map((i) => i.item_code));
  if (codes.some((c) => !known.has(c))) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'provided_item_codes must match the requested items on this notice',
    });
  }

  const responded = await respondToDeficiency(citizen, app, open, {
    narrative: body.narrative,
    provided_item_codes: codes,
    document_id: body.document_id,
  });
  if (!responded.ok) return relay(responded.res);

  const latest = await loadApp(citizen.token, id);
  const decided = latest.app ?? app;
  return json(200, {
    deficiency: responded.notice,
    application: toPortalApplication(
      decided,
      await readWorkingData(citizen, id),
      await readIssuance(citizen, decided),
      catalogueIdForCase(decided),
    ),
    source: 'PLATFORM',
    certified: false,
    g6_issued: false,
  });
}
