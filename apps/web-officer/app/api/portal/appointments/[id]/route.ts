import {
  toAppointmentCard,
  type PlatformAppointmentView,
} from '../../../../../lib/portal/appointments';
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

async function load(
  id: string,
  token: string,
  from: Request,
): Promise<{ status: number; view?: PlatformAppointmentView; body: Record<string, unknown> }> {
  const res = await platform('GET', `/v1/appointments/${id}`, { token, from });
  if (res.status !== 200) return { status: res.status, body: res.body };
  return { status: 200, view: res.body as unknown as PlatformAppointmentView, body: res.body };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await ctx.params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid appointment id' });
  const loaded = await load(id, officer.token, request);
  if (loaded.status !== 200 || !loaded.view) return relay({ status: loaded.status, body: loaded.body });
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    appointment: toAppointmentCard(loaded.view),
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await ctx.params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid appointment id' });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.['action'];
  if (typeof action !== 'string') {
    return json(400, { error_code: 'SF-SYS-003', message: 'action required' });
  }

  const current = await load(id, officer.token, request);
  if (current.status !== 200 || !current.view) {
    return relay({ status: current.status, body: current.body });
  }
  const expectedVersion =
    typeof body?.['expected_version'] === 'number'
      ? body['expected_version']
      : current.view.appointment_version;

  let path: string;
  let payload: Record<string, unknown>;
  switch (action) {
    case 'reschedule': {
      const slotRef = body?.['slot_ref'];
      if (typeof slotRef !== 'string' || slotRef.length === 0) {
        return json(400, { error_code: 'SF-SYS-003', message: 'slot_ref required for reschedule' });
      }
      path = `/v1/appointments/${id}/reschedule`;
      payload = { slot_ref: slotRef, expected_version: expectedVersion };
      break;
    }
    case 'cancel':
      path = `/v1/appointments/${id}/cancel`;
      payload = { expected_version: expectedVersion };
      break;
    case 'complete':
      path = `/v1/appointments/${id}/complete`;
      payload = { expected_version: expectedVersion };
      break;
    case 'no_show':
      path = `/v1/appointments/${id}/no-show`;
      payload = { expected_version: expectedVersion };
      break;
    default:
      return json(400, { error_code: 'SF-SYS-003', message: 'Unknown action' });
  }

  const res = await platform('POST', path, {
    token: officer.token,
    from: request,
    idempotent: true,
    body: payload,
  });
  if (res.status !== 200 && res.status !== 201) return relay(res);
  const view = res.body as unknown as PlatformAppointmentView;
  if (!view?.appointment?.appointment_id) {
    const reloaded = await load(id, officer.token, request);
    if (reloaded.status !== 200 || !reloaded.view) return relay(res);
    return json(200, {
      source: 'PLATFORM',
      g6_issued: false,
      certified: false,
      appointment: toAppointmentCard(reloaded.view),
    });
  }
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    appointment: toAppointmentCard(view),
  });
}
