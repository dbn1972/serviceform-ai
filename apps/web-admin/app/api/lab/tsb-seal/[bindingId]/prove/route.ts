import {
  SAMPLE_LAB_TSB_SEAL_CATALOGUE,
  proveLabTsbEngSeal,
  targetForBinding,
} from '@serviceform/m10-sample-lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Linear UUID check — avoids njsscan regex_dos on user-supplied bindingId. */
function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const c = value.charCodeAt(i);
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (c !== 45) return false;
      continue;
    }
    const isDigit = c >= 48 && c <= 57;
    const isLower = c >= 97 && c <= 102;
    const isUpper = c >= 65 && c <= 70;
    if (!isDigit && !isLower && !isUpper) return false;
  }
  const version = value.charCodeAt(14);
  if (version < 49 || version > 56) return false;
  const variant = value.charAt(19).toLowerCase();
  return variant === '8' || variant === '9' || variant === 'a' || variant === 'b';
}

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
  if (!isUuid(bindingId)) {
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
