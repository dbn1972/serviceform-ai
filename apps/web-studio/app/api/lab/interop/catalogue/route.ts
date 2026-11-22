import { SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE } from '@serviceform/m10-sample-lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * SAMPLE_LAB Studio BFF — interop hygiene catalogue summary (no node modules in client).
 * CERTIFIED=false · G6=false. No Camunda runtime.
 */
export async function GET() {
  const c = SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE;
  return json(200, {
    source: c.source,
    certified: false,
    g6_issued: false,
    camunda_runtime_forbidden: true,
    temporal_remains_runtime: true,
    bpmn_role: c.bpmn_role,
    bpmn_fixtures: c.bpmn_fixtures.map((f) => ({
      fixture_id: f.fixture_id,
      label: f.label,
      direction: f.direction,
      expect_supported: f.expect_supported,
    })),
    sfpackage: {
      package_id: c.sfpackage.package_id,
      catalogue_id: c.sfpackage.catalogue_id,
      label: c.sfpackage.label,
      embedded_secrets_forbidden: true,
    },
    migration_scenarios: c.migration_scenarios.map((s) => ({
      scenario_id: s.scenario_id,
      label: s.label,
      mode: s.mode,
    })),
  });
}
