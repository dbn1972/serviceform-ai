import { SAMPLE_LAB_DEFICIENCY_CATALOGUE } from '@serviceform/m10-sample-lab';
import {
  advanceToScrutiny,
  closeDeficiency,
  listDeficiencies,
  openDeficiency,
} from '../../../../../../lib/portal/deficiency';
import {
  readWorkingData,
  toWorkbenchApplication,
  type PlatformApplication,
} from '../../../../../../lib/portal/cases';
import {
  crossSiteRefusal,
  currentOfficer,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const catalogue = SAMPLE_LAB_DEFICIENCY_CATALOGUE;

async function loadApp(token: string, id: string) {
  const res = await platform('GET', `/v1/applications/${id}`, { token });
  return { res, app: res.body['application'] as PlatformApplication | undefined };
}

/** List deficiencies for this case + SAMPLE_LAB catalogue for the Raise Deficiency form. */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const listed = await listDeficiencies(officer, id);
  if (!listed.ok) return relay(listed.res);
  return json(200, {
    deficiencies: listed.deficiencies,
    catalogue,
    source: 'PLATFORM',
    certified: false,
    g6_issued: false,
  });
}

/**
 * POST actions: RAISE (open CMP-019 notice) or CLOSE (after citizen response).
 * RAISE advances SUBMITTED/RECEIVED → UNDER_SCRUTINY then opens the notice.
 */
export async function POST(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    reason_code?: unknown;
    item_codes?: unknown;
    deficiency_id?: unknown;
    close_reason_code?: unknown;
  } | null;
  if (!body || (body.action !== 'RAISE' && body.action !== 'CLOSE')) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'action must be RAISE or CLOSE',
    });
  }

  const { res, app } = await loadApp(officer.token, id);
  if (res.status !== 200 || !app) return relay(res);

  if (body.action === 'CLOSE') {
    if (typeof body.deficiency_id !== 'string' || !isUuid(body.deficiency_id)) {
      return json(400, { error_code: 'SF-SYS-003', message: 'deficiency_id is required' });
    }
    const closeCode =
      typeof body.close_reason_code === 'string' && body.close_reason_code
        ? body.close_reason_code
        : catalogue.close_reason_codes[0]?.close_reason_code;
    if (
      !closeCode ||
      !catalogue.close_reason_codes.some((c) => c.close_reason_code === closeCode)
    ) {
      return json(400, {
        error_code: 'SF-SYS-003',
        message: 'close_reason_code must be a published catalogue code',
      });
    }
    const closed = await closeDeficiency(officer, body.deficiency_id, closeCode);
    if (!closed.ok) return relay(closed.res);
    const latest = await loadApp(officer.token, id);
    const decided = latest.app ?? app;
    return json(200, {
      deficiency: closed.notice,
      application: toWorkbenchApplication(decided, await readWorkingData(officer, id)),
      source: 'PLATFORM',
      certified: false,
      g6_issued: false,
    });
  }

  // RAISE
  if (typeof body.reason_code !== 'string' || !body.reason_code) {
    return json(400, { error_code: 'SF-SYS-003', message: 'reason_code is required' });
  }
  const reason = catalogue.reasons.find((r) => r.reason_code === body.reason_code);
  if (!reason) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'reason_code must be a published catalogue code',
    });
  }
  const requested =
    Array.isArray(body.item_codes) && body.item_codes.length > 0
      ? body.item_codes.filter((c): c is string => typeof c === 'string')
      : reason.default_item_codes;
  const allowed = new Set(catalogue.item_codes.map((i) => i.item_code));
  if (requested.length < 1 || requested.some((c) => !allowed.has(c))) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'item_codes must be published evidence codes from the catalogue',
    });
  }

  const scrutiny = await advanceToScrutiny(officer, app);
  if (!scrutiny.ok) return relay(scrutiny.res);

  const opened = await openDeficiency(officer, scrutiny.app, {
    reason_code: reason.reason_code,
    notice_code: reason.notice_code,
    instruction_ref: reason.instruction_ref,
    item_codes: requested,
  });
  if (!opened.ok) return relay(opened.res);

  const latest = await loadApp(officer.token, id);
  const decided = latest.app ?? scrutiny.app;
  return json(201, {
    deficiency: opened.notice,
    application: toWorkbenchApplication(decided, await readWorkingData(officer, id)),
    source: 'PLATFORM',
    certified: false,
    g6_issued: false,
  });
}
