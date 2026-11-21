import {
  DOC_KEY_RE,
  ISO_DURATION_RE,
  ITEM_ID_RE,
  SEMVER_RE,
  documentKeyOf,
  type MetaIssue,
} from '../common';
import type { SlaDesign } from './model';

export function slaDocumentKey(design: SlaDesign): string {
  return documentKeyOf(design.packKey, design.version);
}

const PAUSE_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function lintSla(design: SlaDesign): MetaIssue[] {
  const out: MetaIssue[] = [];
  const err = (code: string, message: string, targetId?: string) =>
    out.push({ code, severity: 'error', message, ...(targetId ? { targetId } : {}) });
  const warn = (code: string, message: string, targetId?: string) =>
    out.push({ code, severity: 'warning', message, ...(targetId ? { targetId } : {}) });

  if (!DOC_KEY_RE.test(design.packKey)) {
    err(
      'PACK_KEY_INVALID',
      'SLA pack key must start with a lowercase letter and use a–z, 0–9, ".", "_" or "-".',
    );
  }
  if (design.title.trim().length === 0) err('TITLE_REQUIRED', 'Give the SLA pack a title.');
  if (!SEMVER_RE.test(design.version)) err('VERSION_INVALID', 'Version must look like 1.0.0.');
  if (slaDocumentKey(design).length > 128) {
    err(
      'DOCUMENT_KEY_TOO_LONG',
      'Document key (pack key + version) must be at most 128 characters.',
    );
  }
  if (design.clocks.length === 0) err('CLOCKS_REQUIRED', 'Add at least one SLA clock.');

  const keys = new Set<string>();
  for (const clock of design.clocks) {
    if (!ITEM_ID_RE.test(clock.key)) {
      err('CLOCK_KEY_INVALID', `Clock key "${clock.key || '(empty)'}" is invalid.`, clock.id);
    }
    if (keys.has(clock.key))
      err('CLOCK_KEY_DUPLICATE', `Clock key "${clock.key}" is used twice.`, clock.id);
    keys.add(clock.key);
    if (clock.label.trim().length === 0)
      err('CLOCK_LABEL_REQUIRED', 'Every clock needs a label.', clock.id);
    if (!ISO_DURATION_RE.test(clock.duration_iso)) {
      err('DURATION_INVALID', 'Duration must be ISO-8601 (for example P10D or PT8H).', clock.id);
    }
    for (const code of clock.pause_reason_codes) {
      if (!PAUSE_CODE_RE.test(code)) {
        err('PAUSE_CODE_INVALID', `Pause reason "${code}" must be an upper-case code.`, clock.id);
      }
    }
  }

  if (design.policyKind === 'SAMPLE_LAB_DUMMY' && !design.notStatutory) {
    warn('DUMMY_NOT_MARKED', 'SAMPLE_LAB_DUMMY SLA overlays should stay marked as not statutory.');
  }

  return out;
}
