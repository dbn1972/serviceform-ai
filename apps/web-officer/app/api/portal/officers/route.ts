import { json, platform, simulationAllowed } from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SAMPLE_LAB officers offered by the SIMULATED IdP (LOCAL/CI only). */
export async function GET() {
  if (!simulationAllowed()) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const res = await platform('GET', '/v1/simulated/idp/officers');
  return json(res.status === 200 ? 200 : 503, {
    officers: res.status === 200 ? (res.body['officers'] ?? []) : [],
    simulation: true,
  });
}
