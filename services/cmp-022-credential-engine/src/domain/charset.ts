/**
 * Linear character-class checks for values received from clients and ports, used instead of
 * quantifier regexes (njsscan regex_dos). Each mirrors the frozen pattern documented beside it.
 */
const isUpper = (c: number): boolean => c >= 65 && c <= 90;
const isLower = (c: number): boolean => c >= 97 && c <= 122;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLowerHex = (c: number): boolean => isDigit(c) || (c >= 97 && c <= 102);
const isRefChar = (c: number): boolean =>
  isUpper(c) || isLower(c) || isDigit(c) || c === 95 || c === 46 || c === 58 || c === 45;

function every(value: string, from: number, ok: (c: number) => boolean): boolean {
  for (let i = from; i < value.length; i += 1) if (!ok(value.charCodeAt(i))) return false;
  return true;
}

function bounded(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** ^[A-Za-z0-9_.:-]+$ with the given length bounds (issuance/idempotency keys, opaque refs). */
export function isOpaqueRef(value: unknown, min: number, max: number): value is string {
  return bounded(value, min, max) && every(value, 0, isRefChar);
}

/** ^[A-Za-z0-9_./:-]+$ {1,512} (CMP-032 storage keys, signature refs). */
export function isStorageKey(value: unknown): value is string {
  return bounded(value, 1, 512) && every(value, 0, (c) => isRefChar(c) || c === 47);
}

/** ^[a-f0-9]{64}$ */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && every(value, 0, isLowerHex);
}

const ERROR_FAMILIES = new Set([
  'AUTH',
  'TEN',
  'FORM',
  'RULE',
  'APP',
  'EVD',
  'PAY',
  'WF',
  'CRED',
  'INT',
  'RATE',
  'AI',
  'SYS',
]);

/** ^SF-(AUTH|TEN|...|SYS)-[0-9]{3}$ (SF-CON-COMMON errorCode). */
export function isErrorCode(value: unknown): value is string {
  if (!bounded(value, 10, 12) || !value.startsWith('SF-')) return false;
  const rest = value.slice(3);
  const dash = rest.lastIndexOf('-');
  if (dash < 1) return false;
  const digits = rest.slice(dash + 1);
  return (
    ERROR_FAMILIES.has(rest.slice(0, dash)) && digits.length === 3 && every(digits, 0, isDigit)
  );
}

/** ^[a-z][a-z0-9_]{1,63}$ (simulation marker scenario). */
export function isScenario(value: unknown): value is string {
  if (!bounded(value, 2, 64) || !isLower(value.charCodeAt(0))) return false;
  return every(value, 1, (c) => isLower(c) || isDigit(c) || c === 95);
}
