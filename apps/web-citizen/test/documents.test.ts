import { describe, expect, it } from 'vitest';
import {
  assertAllowedUpload,
  isTechnicallyAccepted,
  sanitizeFileName,
  sha256Hex,
  toDeficiencyEvidence,
  type DocumentView,
} from '../lib/portal/documents';

// REQ SF-49: CMP-013 technical-accept helpers fail closed; never claim business verification.
describe('citizen document upload helpers (SF-49)', () => {
  it('accepts policy-aligned PDF/PNG/JPEG sizes and refuses others', () => {
    expect(assertAllowedUpload({ contentType: 'application/pdf', byteSize: 100 })).toEqual({
      ok: true,
    });
    expect(assertAllowedUpload({ contentType: 'image/png', byteSize: 1 })).toEqual({ ok: true });
    expect(assertAllowedUpload({ contentType: 'text/plain', byteSize: 10 }).ok).toBe(false);
    expect(assertAllowedUpload({ contentType: 'application/pdf', byteSize: 0 }).ok).toBe(false);
    expect(assertAllowedUpload({ contentType: 'application/pdf', byteSize: 2_000_000 }).ok).toBe(
      false,
    );
  });

  it('maps AVAILABLE documents to deficiency evidence refs', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(toDeficiencyEvidence(id)).toEqual({
      evidence_ref: id,
      kind_code: 'CITIZEN_UPLOAD',
    });
  });

  it('treats only AVAILABLE + technically_accepted as usable evidence', () => {
    const available: DocumentView = {
      document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'AVAILABLE',
      technically_accepted: true,
    };
    const pending: DocumentView = {
      document_id: available.document_id,
      status: 'SCAN_PENDING',
      technically_accepted: false,
    };
    expect(isTechnicallyAccepted(available)).toBe(true);
    expect(isTechnicallyAccepted(pending)).toBe(false);
    expect(isTechnicallyAccepted(null)).toBe(false);
  });

  it('sanitizes file names and hashes bytes without logging content', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf')).toBe('.._.._etc_passwd.pdf');
    expect(sanitizeFileName('')).toBe('evidence.bin');
    const bytes = new TextEncoder().encode('%PDF-1.7\nlab\n%%EOF\n');
    expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });
});
