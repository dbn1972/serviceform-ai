import {
  applicationParticipantRef,
  citizenParticipantRef,
  toAppointmentCard,
  type PlatformAppointmentView,
} from '../../../../lib/portal/appointments';
import {
  crossSiteRefusal,
  currentCitizen,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN = 'Sign in with your mobile number to continue';

/** Citizen mine list — participant:citizen:{id} plus optional application-linked bookings. */
export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });

  const citizenRef = citizenParticipantRef(citizen.citizen_id);
  const mine = await platform(
    'GET',
    `/v1/lab/appointments/mine?participant_ref=${encodeURIComponent(citizenRef)}`,
    { token: citizen.token, from: request },
  );
  if (mine.status !== 200) return relay(mine);

  const views = (mine.body['appointments'] ?? []) as PlatformAppointmentView[];
  const byId = new Map(views.map((v) => [v.appointment.appointment_id, v]));

  // Also surface application-linked bookings the citizen owns (wait correlation).
  const apps = await platform('GET', '/v1/applications?limit=20', {
    token: citizen.token,
    from: request,
  });
  if (apps.status === 200) {
    const rows = (apps.body['applications'] ?? []) as { application_id?: string }[];
    for (const row of rows) {
      if (!row.application_id || !isUuid(row.application_id)) continue;
      const ref = applicationParticipantRef(row.application_id);
      const linked = await platform(
        'GET',
        `/v1/lab/appointments/mine?participant_ref=${encodeURIComponent(ref)}`,
        { token: citizen.token, from: request },
      );
      if (linked.status !== 200) continue;
      for (const v of (linked.body['appointments'] ?? []) as PlatformAppointmentView[]) {
        byId.set(v.appointment.appointment_id, v);
      }
    }
  }

  const waitBindings = await platform('GET', '/v1/lab/appointments/wait-bindings', {
    token: citizen.token,
    from: request,
  });

  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    wait_on_appointment_without_polling: true,
    wait_bindings:
      waitBindings.status === 200 ? (waitBindings.body['wait_bindings'] ?? []) : [],
    appointments: [...byId.values()].map(toAppointmentCard),
  });
}

/**
 * Book an appointment. Optional application_id (must be owned) correlates wait release.
 * participant_ref is server-derived — never client-supplied.
 */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const slotRef = body?.['slot_ref'];
  if (typeof slotRef !== 'string' || slotRef.length === 0) {
    return json(400, { error_code: 'SF-SYS-003', message: 'slot_ref required' });
  }

  let participantRef = citizenParticipantRef(citizen.citizen_id);
  const applicationId =
    typeof body?.['application_id'] === 'string' && isUuid(body['application_id'])
      ? body['application_id']
      : null;
  if (applicationId) {
    const owned = await platform('GET', `/v1/applications/${applicationId}`, {
      token: citizen.token,
      from: request,
    });
    if (owned.status !== 200) {
      return json(403, {
        error_code: 'SF-AUTH-002',
        message: 'You can only link a booking to your own application',
      });
    }
    participantRef = applicationParticipantRef(applicationId);
  }

  await platform('POST', '/v1/lab/appointments/ensure', {
    token: citizen.token,
    from: request,
  }).catch(() => undefined);

  const res = await platform('POST', '/v1/appointments', {
    token: citizen.token,
    from: request,
    idempotent: true,
    body: {
      slot_ref: slotRef,
      participant_ref: participantRef,
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
