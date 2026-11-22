import { runInteropHygieneSuite } from '@serviceform/m10-sample-lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * SAMPLE_LAB Studio BFF — BPMN / .sfpackage / migration interop hygiene prove.
 * Catalogue-backed; does not claim G6/CERTIFIED. No Camunda runtime.
 */
export async function POST() {
  const suite = runInteropHygieneSuite({
    environment: process.env['SF_ENVIRONMENT'] === 'CI' ? 'CI' : 'LOCAL',
  });
  return json(suite.ok ? 200 : 400, {
    ...suite,
    g6_issued: false,
    note: 'Lab interop hygiene only. No Camunda runtime. CERTIFIED=false. G6=false.',
  });
}
