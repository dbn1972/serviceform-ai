import {
  parseResultCode,
  toInspectionCard,
  type PlatformInspection,
} from '../../../../../lib/portal/inspections';
import {
  crossSiteRefusal,
  currentOfficer,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

async function loadInspection(
  id: string,
  token: string,
  request: Request,
): Promise<{ status: number; body: Record<string, unknown>; row?: PlatformInspection }> {
  const res = await platform('GET', `/v1/inspections/${id}`, { token, from: request });
  if (res.status !== 200) return res;
  return { ...res, row: res.body as unknown as PlatformInspection };
}

export async function GET(request: Request, { params }: Params) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid inspection id' });
  const res = await loadInspection(id, officer.token, request);
  if (res.status !== 200 || !res.row) return relay(res);
  const detail = await platform('GET', `/v1/inspections/${id}/detail`, {
    token: officer.token,
    from: request,
  });
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    inspection: toInspectionCard(res.row),
    detail: detail.status === 200 ? detail.body : null,
  });
}

/**
 * Desk actions: schedule | start | result | complete | cancel | checklist.
 * Bodies stay non-statutory — DEFICIENCY_NOTED is a verification result, not APPROVED/REJECTED.
 */
export async function POST(request: Request, { params }: Params) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid inspection id' });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.['action'];
  const token = officer.token;

  async function mutate(path: string, payload?: Record<string, unknown>) {
    const res = await platform('POST', path, {
      token,
      from: request,
      idempotent: true,
      ...(payload !== undefined ? { body: payload } : {}),
    });
    if (res.status !== 200 && res.status !== 201) return res;
    const loaded = await loadInspection(id, token, request);
    if (loaded.status !== 200 || !loaded.row) return loaded;
    return {
      status: 200,
      body: {
        source: 'PLATFORM',
        g6_issued: false,
        certified: false,
        inspection: toInspectionCard(loaded.row),
      },
    };
  }

  if (action === 'schedule') {
    const windowStart =
      typeof body?.['window_start'] === 'string' ? body['window_start'] : undefined;
    const windowEnd = typeof body?.['window_end'] === 'string' ? body['window_end'] : undefined;
    const slotRef = typeof body?.['slot_ref'] === 'string' ? body['slot_ref'] : undefined;
    const locationRef =
      typeof body?.['location_ref'] === 'string' ? body['location_ref'] : undefined;
    const timezone =
      typeof body?.['timezone_iana'] === 'string' ? body['timezone_iana'] : 'Asia/Kolkata';
    if (!windowStart && !windowEnd && !slotRef && !locationRef) {
      return json(400, { error_code: 'SF-SYS-003', message: 'Schedule metadata required' });
    }
    const res = await mutate(`/v1/inspections/${id}/schedule`, {
      ...(windowStart ? { window_start: windowStart } : {}),
      ...(windowEnd ? { window_end: windowEnd } : {}),
      ...(slotRef ? { slot_ref: slotRef } : {}),
      ...(locationRef ? { location_ref: locationRef } : {}),
      timezone_iana: timezone,
    });
    if (res.status !== 200) return relay(res);
    return json(200, res.body);
  }

  if (action === 'start') {
    const res = await mutate(`/v1/inspections/${id}/start`);
    if (res.status !== 200) return relay(res);
    return json(200, res.body);
  }

  if (action === 'result') {
    const code = parseResultCode(body?.['verification_result']);
    if (!code) {
      return json(400, {
        error_code: 'SF-SYS-003',
        message: 'verification_result must be VERIFIED | NOT_VERIFIED | INCONCLUSIVE | DEFICIENCY_NOTED',
      });
    }
    const res = await mutate(`/v1/inspections/${id}/result`, { verification_result: code });
    if (res.status !== 200) return relay(res);
    return json(200, res.body);
  }

  if (action === 'checklist') {
    const itemCode = typeof body?.['item_code'] === 'string' ? body['item_code'] : '';
    const itemState = typeof body?.['item_state'] === 'string' ? body['item_state'] : '';
    if (!itemCode || !itemState) {
      return json(400, { error_code: 'SF-SYS-003', message: 'item_code and item_state required' });
    }
    const res = await mutate(`/v1/inspections/${id}/checklist`, {
      item_code: itemCode,
      item_state: itemState,
      required: body?.['required'] === false ? false : true,
    });
    if (res.status !== 200) return relay(res);
    return json(200, res.body);
  }

  if (action === 'complete') {
    const res = await mutate(`/v1/inspections/${id}/complete`);
    if (res.status !== 200) return relay(res);
    return json(200, res.body);
  }

  if (action === 'cancel') {
    const res = await mutate(`/v1/inspections/${id}/cancel`);
    if (res.status !== 200) return relay(res);
    return json(200, res.body);
  }

  return json(400, {
    error_code: 'SF-SYS-003',
    message: 'action must be schedule | start | result | checklist | complete | cancel',
  });
}
