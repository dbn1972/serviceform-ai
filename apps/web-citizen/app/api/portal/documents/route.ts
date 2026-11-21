import { randomUUID } from 'node:crypto';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  uploadEvidenceDocument,
} from '../../../../lib/portal/documents';
import {
  crossSiteRefusal,
  currentCitizen,
  isUuid,
  json,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SAMPLE_LAB citizen evidence upload (SF-49 / CMP-013).
 * Multipart: file (+ optional application_id). Returns technically_accepted document view.
 * CERTIFIED=false. G6=false. Never business-verifies evidence.
 */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request, { allowMultipart: true });
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) {
    return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error_code: 'SF-SYS-003', message: 'Expected multipart form data' });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'A file is required' });
  }
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'This file is too large. Maximum size is 1 MB in SAMPLE_LAB.',
    });
  }
  const contentType = (file.type || '').toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_CONTENT_TYPES)[number])) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'This file type is not accepted. Use PDF, PNG or JPEG.',
    });
  }
  const applicationIdRaw = form.get('application_id');
  const applicationRef =
    typeof applicationIdRaw === 'string' && isUuid(applicationIdRaw) ? applicationIdRaw : undefined;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const idempotencyKey =
    request.headers.get('idempotency-key')?.trim() ||
    `upload-${citizen.citizen_id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  const result = await uploadEvidenceDocument(citizen, {
    bytes,
    contentType,
    fileName: file.name || 'evidence.bin',
    ...(applicationRef ? { applicationRef } : {}),
    idempotencyKey,
  });
  if (!result.ok) {
    if (result.message) {
      return json(result.res.status >= 400 ? result.res.status : 422, {
        error_code: String(result.res.body['error_code'] ?? 'SF-EVD-002'),
        message: result.message,
        ...(Array.isArray(result.res.body['details'])
          ? { details: result.res.body['details'] }
          : {}),
        certified: false,
        g6_issued: false,
      });
    }
    return relay(result.res);
  }

  return json(201, {
    document: result.document,
    file_name: result.file_name,
    content_type: result.content_type,
    technically_accepted: true,
    business_verified: false,
    simulation: true,
    certified: false,
    g6_issued: false,
  });
}
