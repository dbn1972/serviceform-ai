import {
  toAppointmentCard,
  type PlatformAppointmentView,
} from '../../../../lib/portal/appointments';
import {
  crossSiteRefusal,
  currentOfficer,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Book an appointment against an opaque slot_ref (atomic capacity). */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const slotRef = body?.['slot_ref'];
  if (typeof slotRef !== 'string' || slotRef.length === 0) {
    return json(400, { error_code: 'SF-SYS-003', message: 'slot_ref required' });
  }
  const participantRef =
    typeof body?.['participant_ref'] === 'string' && body['participant_ref'].length > 0
      ? body['participant_ref']
      : null;
  const res = await platform('POST', '/v1/appointments', {
    token: officer.token,
    from: request,
    idempotent: true,
    body: {
      slot_ref: slotRef,
      ...(participantRef ? { participant_ref: participantRef } : {}),
    },
  });
  if (res.status !== 201 && res.status !== 200) return relay(res);
  const view = res.body as unknown as PlatformAppointmentView;
  if (!view?.appointment?.appointment_id) return relay(res);
  return json(201, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    appointment: toAppointmentCard(view),
  });
}
