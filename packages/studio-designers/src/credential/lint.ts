import { DOC_KEY_RE, SEMVER_RE, documentKeyOf, type MetaIssue } from '../common';
import type { CredentialDesign } from './model';

export function credentialDocumentKey(design: CredentialDesign): string {
  return documentKeyOf(design.packKey, design.version);
}

export function lintCredential(design: CredentialDesign): MetaIssue[] {
  const out: MetaIssue[] = [];
  const err = (code: string, message: string) => out.push({ code, severity: 'error', message });
  const warn = (code: string, message: string) => out.push({ code, severity: 'warning', message });

  if (!DOC_KEY_RE.test(design.packKey)) {
    err(
      'PACK_KEY_INVALID',
      'Credential pack key must start with a lowercase letter and use a–z, 0–9, ".", "_" or "-".',
    );
  }
  if (design.title.trim().length === 0)
    err('TITLE_REQUIRED', 'Give the credential template a title.');
  if (!SEMVER_RE.test(design.version)) err('VERSION_INVALID', 'Version must look like 1.0.0.');
  if (credentialDocumentKey(design).length > 128) {
    err(
      'DOCUMENT_KEY_TOO_LONG',
      'Document key (pack key + version) must be at most 128 characters.',
    );
  }
  if (!DOC_KEY_RE.test(design.templateKey)) {
    err('TEMPLATE_KEY_INVALID', 'Template key must be a lowercase document key.');
  }
  if (design.displayTitle.trim().length === 0) {
    err('DISPLAY_TITLE_REQUIRED', 'Citizen-facing display title is required.');
  }
  if (design.policyKind === 'SAMPLE_LAB_DUMMY' && !design.notStatutory) {
    warn(
      'DUMMY_NOT_MARKED',
      'SAMPLE_LAB_DUMMY credential overlays should stay marked as not statutory.',
    );
  }
  if (
    design.policyKind === 'SAMPLE_LAB_DUMMY' &&
    !/SAMPLE_LAB|DUMMY/i.test(design.digilockerLabel)
  ) {
    warn(
      'DUMMY_LABEL_MISSING',
      'DigiLocker label should include SAMPLE_LAB or DUMMY so overlays are not mistaken for statute.',
    );
  }
  return out;
}
