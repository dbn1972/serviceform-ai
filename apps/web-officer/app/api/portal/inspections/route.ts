import {
  labCreateBody,
  toInspectionCard,
  type PlatformInspection,
} from '../../../../lib/portal/inspections';
import {
  crossSiteRefusal,
  currentOfficer,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Inspection desk queue — CMP-018 listAvailable (REQUESTED/SCHEDULED matching assignment). */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const res = await platform('GET', '/v1/inspections/available', {
    token: officer.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const items = (res.body['items'] ?? []) as PlatformInspection[];
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    inspections: items.map(toInspectionCard),
  });
}

/** Create inspection from published pin metadata (no service forks). */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const applicationId = body?.['application_id'];
  const pinCode = body?.['pin_code'];
  if (!isUuid(applicationId)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'application_id required' });
  }
  if (typeof pinCode !== 'string' || pinCode.length === 0) {
    return json(400, { error_code: 'SF-SYS-003', message: 'pin_code required' });
  }
  const create = labCreateBody({
    application_id: applicationId,
    pin_code: pinCode,
    service_scope_id: typeof body?.['service_scope_id'] === 'string' ? body['service_scope_id'] : null,
  });
  if (!create) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Unknown inspection pin_code' });
  }
  const res = await platform('POST', '/v1/inspections', {
    token: officer.token,
    from: request,
    idempotent: true,
    body: create,
  });
  if (res.status !== 201 && res.status !== 200) return relay(res);
  const row = res.body as unknown as PlatformInspection;
  // createInspection returns the InspectionView at top level (status 201 body).
  const inspection =
    'inspection_id' in res.body
      ? (res.body as unknown as PlatformInspection)
      : ((res.body['inspection'] as PlatformInspection | undefined) ?? row);
  if (!inspection?.inspection_id) return relay(res);
  return json(201, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    inspection: toInspectionCard(inspection),
  });
}
