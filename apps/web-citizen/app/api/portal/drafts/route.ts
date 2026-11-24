import {
  createDraft,
  draftView,
  parseDraftSave,
  sessionKey,
  writeDraftData,
} from '../../../../lib/portal/drafts';
import {
  liveOfferingFormPin,
  offeredForm,
  pinFor,
  sampleLab,
  syntheticNameRefusal,
} from '../../../../lib/portal/forms';
import { crossSiteRefusal, currentCitizen, json } from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start a saved application: a CMP-015 DRAFT on the offering's published binding plus the
 * citizen's answers so far. One draft per browser form session (idempotency-key). SAMPLE_LAB still
 * refuses non-synthetic person names before anything is stored (Phase A L-2).
 */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const key = sessionKey(request.headers.get('idempotency-key'));
  if (!key) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Send a form-session idempotency key' });
  }
  const input = parseDraftSave(await request.json().catch(() => null));
  if (!input) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Send the form answers as an object' });
  }
  const offered = offeredForm(input.catalogueId);
  if (!offered) return json(404, { error_code: 'SF-SYS-002', message: 'Service not offered here' });
  if (sampleLab()) {
    const named = syntheticNameRefusal(offered.version.form.json_schema, input.data);
    if (named) return json(400, { error_code: 'SF-SYS-003', ...named });
  }
  const pin = await liveOfferingFormPin(citizen, input.catalogueId, pinFor(offered.version));
  const created = await createDraft(citizen, offered.offering, pin.version_id, `draft-${key}`);
  if (!created.ok) return created.response;
  const saved = await writeDraftData(citizen, created.app, input.data, {
    expectedRevision: null,
    key: `draft-${key}`,
  });
  if (!saved.ok) return saved.response;
  return json(201, {
    draft: draftView(saved.app, saved.meta),
    certified: false,
    g6_issued: false,
  });
}
