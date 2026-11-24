import {
  ALREADY_SUBMITTED,
  draftView,
  isResumable,
  ownDraft,
  parseDraftSave,
  readOwnCase,
  readWorkingDataMeta,
  sessionKey,
  writeDraftData,
} from '../../../../../lib/portal/drafts';
import {
  liveOfferingFormPin,
  offeredForm,
  pinFor,
  sampleLab,
  syntheticNameRefusal,
} from '../../../../../lib/portal/forms';
import { crossSiteRefusal, currentCitizen, json } from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const SIGN_IN = { error_code: 'SF-AUTH-001', message: 'Sign in to continue' };

/** A saved application and its answers, for the owner only (CMP-015 RLS + OPA citizen-owner). */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, SIGN_IN);
  const own = await readOwnCase(citizen, id);
  if (!own.ok) return own.response;
  if (!isResumable(own.app.state)) {
    return json(409, {
      error_code: 'SF-APP-001',
      message: ALREADY_SUBMITTED,
      application_id: own.app.application_id,
    });
  }
  const meta = await readWorkingDataMeta(citizen, id);
  return json(200, {
    draft: { ...draftView(own.app, meta), data: meta?.data ?? {} },
    certified: false,
    g6_issued: false,
  });
}

/** Save the latest answers on the citizen's draft (optimistic: `expected_revision` is required). */
export async function PUT(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { id } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, SIGN_IN);
  const input = parseDraftSave(await request.json().catch(() => null));
  if (!input || input.expectedRevision === null) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Send the form answers and the revision you last saved',
    });
  }
  const offered = offeredForm(input.catalogueId);
  if (!offered) return json(404, { error_code: 'SF-SYS-002', message: 'Service not offered here' });
  if (sampleLab()) {
    const named = syntheticNameRefusal(offered.version.form.json_schema, input.data);
    if (named) return json(400, { error_code: 'SF-SYS-003', ...named });
  }
  const pin = await liveOfferingFormPin(citizen, input.catalogueId, pinFor(offered.version));
  const draft = await ownDraft(citizen, id, offered.offering, pin.version_id);
  if (!draft.ok) return draft.response;
  const key = sessionKey(request.headers.get('idempotency-key'));
  const saved = await writeDraftData(citizen, draft.app, input.data, {
    expectedRevision: input.expectedRevision,
    key: key ? `draft-${key}` : null,
  });
  if (!saved.ok) return saved.response;
  return json(200, { draft: draftView(saved.app, saved.meta), certified: false, g6_issued: false });
}
