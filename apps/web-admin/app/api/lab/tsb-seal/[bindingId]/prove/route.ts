import {
  SAMPLE_LAB_TSB_SEAL_CATALOGUE,
  proveLabTsbEngSeal,
  targetForBinding,
} from '@serviceform/m10-sample-lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * SAMPLE_LAB Admin BFF — eng seal prove (SF-60).
 * Catalogue-backed; does not claim G6/CERTIFIED. Owner owns human G6 seal claim.
 */
export async function POST(_request: Request, context: { params: Promise<{ bindingId: string }> }) {
  const { bindingId } = await context.params;
  if (!UUID_RE.test(bindingId)) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'bindingId must be a UUID',
      certified: false,
      g6_issued: false,
      tsb_immutability_sealed: false,
    });
  }
  const target =
    targetForBinding(SAMPLE_LAB_TSB_SEAL_CATALOGUE, bindingId) ??
    SAMPLE_LAB_TSB_SEAL_CATALOGUE.targets[0];
  if (!target) {
    return json(404, {
      error_code: 'SF-APP-001',
      message: 'TSB seal subject not found',
      certified: false,
      g6_issued: false,
      tsb_immutability_sealed: false,
    });
  }
  const attestation = proveLabTsbEngSeal({
    environment: process.env['SF_ENVIRONMENT'] === 'CI' ? 'CI' : 'LOCAL',
    source: 'SAMPLE_LAB',
    binding: {
      binding_id: target.tenant_service_binding_id,
      catalogue_id: target.catalogue_id,
      binding_key: target.binding_key,
      offering_ref: target.offering_ref,
      metadata_bundle_ref: target.metadata_bundle_ref,
      status: target.status,
      pins: target.pins,
      artifact_hash: target.artifact_hash,
    },
  });
  return json(attestation.lab_eng_sealed ? 200 : 400, {
    ...attestation,
    g6_issued: false,
    note: 'Lab eng seal only. Owner still owns human G6 seal claim.',
  });
}
