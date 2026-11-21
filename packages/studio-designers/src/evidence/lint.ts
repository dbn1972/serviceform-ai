import {
  DOC_KEY_RE,
  ITEM_ID_RE,
  SEMVER_RE,
  documentKeyOf,
  type MetaIssue,
} from '../common';
import type { EvidenceDesign } from './model';

export function evidenceDocumentKey(design: EvidenceDesign): string {
  return documentKeyOf(design.packKey, design.version);
}

const ARTIFACT_RE = /^[a-z][a-z0-9._-]{1,63}$/;

export function lintEvidence(design: EvidenceDesign): MetaIssue[] {
  const out: MetaIssue[] = [];
  const err = (code: string, message: string, targetId?: string) =>
    out.push({ code, severity: 'error', message, ...(targetId ? { targetId } : {}) });
  const warn = (code: string, message: string, targetId?: string) =>
    out.push({ code, severity: 'warning', message, ...(targetId ? { targetId } : {}) });

  if (!DOC_KEY_RE.test(design.packKey)) {
    err(
      'PACK_KEY_INVALID',
      'Evidence pack key must start with a lowercase letter and use a–z, 0–9, ".", "_" or "-".',
    );
  }
  if (design.title.trim().length === 0) err('TITLE_REQUIRED', 'Give the evidence pack a title.');
  if (!SEMVER_RE.test(design.version)) err('VERSION_INVALID', 'Version must look like 1.0.0.');
  if (evidenceDocumentKey(design).length > 128) {
    err('DOCUMENT_KEY_TOO_LONG', 'Document key (pack key + version) must be at most 128 characters.');
  }
  if (design.requirements.length === 0) {
    err('REQUIREMENTS_REQUIRED', 'Add at least one evidence requirement.');
  }

  const keys = new Set<string>();
  for (const req of design.requirements) {
    if (!ITEM_ID_RE.test(req.key)) {
      err('REQ_KEY_INVALID', `Requirement key "${req.key || '(empty)'}" is invalid.`, req.id);
    }
    if (keys.has(req.key))
      err('REQ_KEY_DUPLICATE', `Requirement key "${req.key}" is used twice.`, req.id);
    keys.add(req.key);
    if (req.label.trim().length === 0)
      err('REQ_LABEL_REQUIRED', 'Every requirement needs a label.', req.id);
    if (!ARTIFACT_RE.test(req.artifact_type)) {
      err(
        'ARTIFACT_TYPE_INVALID',
        'Artifact type must be a lowercase key (for example proof_of_address).',
        req.id,
      );
    }
  }

  if (design.policyKind === 'SAMPLE_LAB_DUMMY' && !design.notStatutory) {
    warn(
      'DUMMY_NOT_MARKED',
      'SAMPLE_LAB_DUMMY evidence overlays should stay marked as not statutory.',
    );
  }

  return out;
}
