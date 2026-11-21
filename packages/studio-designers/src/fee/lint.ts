import { DOC_KEY_RE, ITEM_ID_RE, SEMVER_RE, documentKeyOf, type MetaIssue } from '../common';
import type { FeeDesign } from './model';

export function feeDocumentKey(design: FeeDesign): string {
  return documentKeyOf(design.packKey, design.version);
}

export function lintFee(design: FeeDesign): MetaIssue[] {
  const out: MetaIssue[] = [];
  const err = (code: string, message: string, targetId?: string) =>
    out.push({ code, severity: 'error', message, ...(targetId ? { targetId } : {}) });
  const warn = (code: string, message: string, targetId?: string) =>
    out.push({ code, severity: 'warning', message, ...(targetId ? { targetId } : {}) });

  if (!DOC_KEY_RE.test(design.packKey)) {
    err(
      'PACK_KEY_INVALID',
      'Fee pack key must start with a lowercase letter and use a–z, 0–9, ".", "_" or "-".',
    );
  }
  if (design.title.trim().length === 0) err('TITLE_REQUIRED', 'Give the fee schedule a title.');
  if (!SEMVER_RE.test(design.version)) err('VERSION_INVALID', 'Version must look like 1.0.0.');
  if (feeDocumentKey(design).length > 128) {
    err(
      'DOCUMENT_KEY_TOO_LONG',
      'Document key (pack key + version) must be at most 128 characters.',
    );
  }
  if (design.currency !== 'INR')
    err('CURRENCY_UNSUPPORTED', 'SAMPLE_LAB fee designer supports INR only.');
  if (design.items.length === 0) err('ITEMS_REQUIRED', 'Add at least one fee line.');

  const keys = new Set<string>();
  for (const item of design.items) {
    if (!ITEM_ID_RE.test(item.key)) {
      err('ITEM_KEY_INVALID', `Fee line key "${item.key || '(empty)'}" is invalid.`, item.id);
    }
    if (keys.has(item.key))
      err('ITEM_KEY_DUPLICATE', `Fee line key "${item.key}" is used twice.`, item.id);
    keys.add(item.key);
    if (item.label.trim().length === 0)
      err('ITEM_LABEL_REQUIRED', 'Every fee line needs a label.', item.id);
    if (!Number.isInteger(item.amount_minor) || item.amount_minor < 0) {
      err(
        'AMOUNT_INVALID',
        'Amount must be a non-negative integer in minor units (paise).',
        item.id,
      );
    }
  }

  if (design.policyKind === 'SAMPLE_LAB_DUMMY' && !design.notStatutory) {
    warn('DUMMY_NOT_MARKED', 'SAMPLE_LAB_DUMMY fee overlays should stay marked as not statutory.');
  }
  if (design.policyKind === 'SAMPLE_LAB_DUMMY' && !/SAMPLE_LAB|DUMMY/i.test(design.amountDisplay)) {
    warn(
      'DUMMY_LABEL_MISSING',
      'Citizen amount display should include SAMPLE_LAB or DUMMY so overlays are not mistaken for statute.',
    );
  }
  if (design.policyKind === 'ZERO' && design.items.some((i) => i.amount_minor !== 0)) {
    err(
      'ZERO_POLICY_MISMATCH',
      'ZERO policy requires every fee line amount to be 0.',
      design.items[0]?.id,
    );
  }

  return out;
}
