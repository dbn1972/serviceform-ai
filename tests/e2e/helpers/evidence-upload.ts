/**
 * SAMPLE_LAB CMP-013 evidence helpers for Playwright E2E (SF-49).
 * Uploads a tiny synthetic PDF via the citizen BFF and waits for technical accept.
 * CERTIFIED=false · G6=false · never business-verifies.
 */
import { randomInt } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';

/** Minimal PDF bytes accepted by SAMPLE_LAB_EVIDENCE (PDF MIME + non-empty). */
export const SAMPLE_EVIDENCE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
  'utf8',
);

export type UploadedEvidence = {
  document_id: string;
  content_type: string;
  file_name: string;
};

/** Multipart upload through the citizen BFF; returns AVAILABLE document id. */
export async function uploadEvidenceViaApi(
  request: APIRequestContext,
  cookie: string,
  options?: { baseUrl?: string; fileName?: string },
): Promise<UploadedEvidence> {
  const baseUrl = options?.baseUrl ?? CITIZEN;
  const fileName = options?.fileName ?? 'sample-evidence.pdf';
  const res = await request.post(`${baseUrl}/api/portal/documents`, {
    headers: {
      cookie,
      'idempotency-key': `e2e-evd-${randomInt(1e9)}`,
    },
    multipart: {
      file: {
        name: fileName,
        mimeType: 'application/pdf',
        buffer: SAMPLE_EVIDENCE_PDF,
      },
    },
  });
  expect(res.status(), `evidence upload ${await res.text()}`).toBe(201);
  const body = (await res.json()) as {
    document: { document_id: string; status: string; technically_accepted?: boolean };
    content_type?: string;
    file_name?: string;
    technically_accepted?: boolean;
  };
  expect(body.document.document_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(body.document.status).toBe('AVAILABLE');
  expect(body.technically_accepted ?? body.document.technically_accepted).toBe(true);
  return {
    document_id: body.document.document_id,
    content_type: body.content_type ?? 'application/pdf',
    file_name: body.file_name ?? fileName,
  };
}

/**
 * When the published schema collects evidence_file_name, pin an AVAILABLE CMP-013 id.
 * No-op for catalogue forms without that property.
 */
export async function withEvidenceIfRequired(
  request: APIRequestContext,
  cookie: string,
  schema: unknown,
  data: Record<string, unknown>,
  options?: { baseUrl?: string },
): Promise<Record<string, unknown>> {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  if (!props || !Object.hasOwn(props, 'evidence_file_name')) return data;
  const uploaded = await uploadEvidenceViaApi(request, cookie, options);
  return {
    ...data,
    evidence_file_name: uploaded.document_id,
    evidence_mime: uploaded.content_type,
  };
}

/** UI: attach a synthetic PDF on the Evidence wizard step and wait for technical accept. */
export async function uploadEvidenceOnWizard(page: Page): Promise<void> {
  const field = page.getByTestId('evidence-upload-field');
  await expect(field).toBeVisible();
  await field.locator('input[type="file"]').setInputFiles({
    name: 'sample-evidence.pdf',
    mimeType: 'application/pdf',
    buffer: SAMPLE_EVIDENCE_PDF,
  });
  await expect(page.getByText(/Upload accepted/i)).toBeVisible({
    timeout: 30_000,
  });
}
