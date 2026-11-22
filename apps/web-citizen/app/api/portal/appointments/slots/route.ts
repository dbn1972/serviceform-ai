import {
  SAMPLE_LAB_SLOT_TEMPLATES,
  toSlotCard,
  type PlatformSlot,
} from '../../../../../lib/portal/appointments';
import { currentCitizen, json, platform, relay } from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN = 'Sign in with your mobile number to continue';

/** List capacity slots with remaining capacity (CMP-056 · citizen). */
export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });

  await platform('POST', '/v1/lab/appointments/ensure', {
    token: citizen.token,
    from: request,
  }).catch(() => undefined);

  const url = new URL(request.url);
  const typeId = url.searchParams.get('appointment_type_id');
  const path =
    typeId && typeId.length > 0
      ? `/v1/appointments/slots?appointment_type_id=${encodeURIComponent(typeId)}`
      : '/v1/appointments/slots';
  const res = await platform('GET', path, { token: citizen.token, from: request });
  if (res.status !== 200) return relay(res);
  const slots = (res.body['slots'] ?? []) as PlatformSlot[];

  const typeRefById = new Map<string, string>();
  for (const slot of slots) {
    const template = SAMPLE_LAB_SLOT_TEMPLATES.find((t) => t.slot_ref === slot.slot_ref);
    if (template) typeRefById.set(slot.appointment_type_id, template.appointment_type_ref);
  }

  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    capacity_atomic: res.body['capacity_atomic'] === true,
    slots: slots.map((s) => toSlotCard(s, typeRefById)),
  });
}
