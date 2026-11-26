/**
 * Browser-safe citizen policy copy helpers (no Node / service-templates imports).
 * Catalogue cards and client chrome use these so SAMPLE_LAB sample dumps stay scannable.
 */

const PENDING = 'POLICY_INPUT_REQUIRED';

/** True when catalogue policy facts are SAMPLE_LAB sample/DUMMY overlays (not locked statute). */
export function isSampleLabPolicy(value: string): boolean {
  return /SAMPLE_LAB\s+(?:DUMMY|sample)/i.test(value);
}

/**
 * Citizen-facing copy for a policy fact the department has not published yet.
 * Keeps raw catalogue strings for detail/Studio honesty tags; prefer `citizenPolicyText` on cards.
 */
export function policyText(value: string): string {
  return value === PENDING ? 'To be published by the department' : value;
}

/**
 * Short human policy fact for citizen cards and primary chrome.
 * Strips SAMPLE_LAB sample preambles and "(configurable per tenant)" so Fee never dumps lab jargon.
 */
export function citizenPolicyText(value: string): string {
  if (value === PENDING) return 'To be published by the department';
  if (!isSampleLabPolicy(value)) return value;
  const withoutPrefix = value.replace(/^SAMPLE_LAB\s+(?:DUMMY|sample)\s*[·•\-–—]\s*/i, '');
  const withoutConfigurable = withoutPrefix.replace(/\s*\(configurable[^)]*\)\s*$/i, '').trim();
  if (withoutConfigurable && withoutConfigurable !== value) return withoutConfigurable;
  return 'Sample lab parameters';
}
