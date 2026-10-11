/**
 * Linear character-class checks for values received from ports, used instead of quantifier
 * regexes (njsscan regex_dos). Each mirrors the pattern documented beside it.
 */
const isUpper = (c: number): boolean => c >= 65 && c <= 90;
const isLower = (c: number): boolean => c >= 97 && c <= 122;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLowerHex = (c: number): boolean => isDigit(c) || (c >= 97 && c <= 102);

function every(value: string, from: number, ok: (c: number) => boolean): boolean {
  for (let i = from; i < value.length; i += 1) if (!ok(value.charCodeAt(i))) return false;
  return true;
}

/** ^[A-Z0-9_.-]{1,64}$ */
export function isLineCode(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 64 &&
    every(value, 0, (c) => isUpper(c) || isDigit(c) || c === 95 || c === 46 || c === 45)
  );
}

/** ^[A-Za-z][A-Za-z0-9_.]{0,63}$ */
export function isRuleOutputKey(value: string): boolean {
  if (value.length < 1 || value.length > 64) return false;
  const first = value.charCodeAt(0);
  if (!isUpper(first) && !isLower(first)) return false;
  return every(value, 1, (c) => isUpper(c) || isLower(c) || isDigit(c) || c === 95 || c === 46);
}

/** ^[A-Z]{3}$ */
export function isCurrencyCode(value: string): boolean {
  return value.length === 3 && every(value, 0, isUpper);
}

/** ^sha256:[0-9a-f]{64}$ */
export function isSha256Prefixed(value: string): boolean {
  return value.length === 71 && value.startsWith('sha256:') && every(value, 7, isLowerHex);
}
