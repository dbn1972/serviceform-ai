const MAX_TIMESTAMP_LENGTH = 40;
const DIGIT_POSITIONS = [0, 1, 2, 3, 5, 6, 8, 9] as const;

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/**
 * Length-bounded, fixed-position check of the `YYYY-MM-DDT` prefix. No pattern matching is applied
 * to caller input, so there is no backtracking surface.
 */
export function hasIsoDateTimePrefix(value: string): boolean {
  if (value.length < 11 || value.length > MAX_TIMESTAMP_LENGTH) return false;
  if (value.charAt(4) !== '-' || value.charAt(7) !== '-' || value.charAt(10) !== 'T') return false;
  return DIGIT_POSITIONS.every((i) => isDigit(value.charCodeAt(i)));
}

/** Epoch milliseconds of a bounded ISO date-time, or `null` when it is not one. */
export function parseIsoInstant(value: string): number | null {
  if (!hasIsoDateTimePrefix(value)) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}
