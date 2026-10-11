export const CHANNELS = ['SMS', 'EMAIL', 'PUSH', 'IN_APP'] as const;
export type Channel = (typeof CHANNELS)[number];

export const HANDLE_CLASSES = [
  'CITIZEN_HANDLE_REF',
  'OFFICIAL_HANDLE_REF',
  'SYSTEM_HANDLE_REF',
] as const;
export type HandleClass = (typeof HANDLE_CLASSES)[number];

export const CONNECTOR_MODES = ['REAL', 'SANDBOX', 'SIMULATED'] as const;
export type ConnectorMode = (typeof CONNECTOR_MODES)[number];

export const ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
] as const;
export type DeploymentEnvironment = (typeof ENVIRONMENTS)[number];

export const SIMULATION_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
] as const;
export type SimulationEnvironment = (typeof SIMULATION_ENVIRONMENTS)[number];

export const DISPATCH_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'UNDELIVERED',
  'FAILED',
] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const ATTEMPT_OUTCOMES = [
  'ACCEPTED',
  'TRANSIENT_FAILURE',
  'PERMANENT_FAILURE',
  'ABANDONED',
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/**
 * Channel -> INT-013 connector_type. PUSH and IN_APP have no connector_type in the frozen
 * SF-CON-CONNECTOR-BINDING enum, so they fail closed until a Contract Change Request adds one.
 */
export const CHANNEL_CONNECTOR_TYPE: Readonly<Partial<Record<Channel, string>>> = {
  SMS: 'SMS',
  EMAIL: 'EMAIL',
};

export const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export const DEFAULT_MAX_ATTEMPTS = 5;
export const LEASE_MS = 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60_000;

/** Deterministic exponential backoff (no jitter) so retries are reproducible under a test clock. */
export function backoffMs(attemptsSoFar: number): number {
  const exp = Math.max(0, attemptsSoFar - 1);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exp);
}

const MAX_REF_LENGTH = 128;
const MAX_SECRET_REF_LENGTH = 512;
const SECRET_REF_PREFIXES = ['aws-sm://', 'aws-ssm://', 'vault://'] as const;

const isLower = (c: number): boolean => c >= 97 && c <= 122;
const isUpper = (c: number): boolean => c >= 65 && c <= 90;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/**
 * Charset validators are linear single-pass scans guarded by a length bound checked first; they
 * replace regular expressions on client-supplied text so no input can trigger backtracking.
 */
function onlyAllowed(value: string, start: number, extra: string): boolean {
  for (let i = start; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (!isLower(c) && !isUpper(c) && !isDigit(c) && !extra.includes(value.charAt(i))) return false;
  }
  return true;
}

/** `[A-Za-z0-9_.:-]{1,128}` */
export function isTemplateRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_REF_LENGTH &&
    onlyAllowed(value, 0, '_.:-')
  );
}

/** `[A-Za-z0-9_.:-]{8,128}` */
export function isHandleRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= MAX_REF_LENGTH &&
    onlyAllowed(value, 0, '_.:-')
  );
}

/** `ll` or `ll-CC` (two lowercase letters, optional hyphen and two uppercase letters). */
export function isLocale(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length !== 2 && value.length !== 5) return false;
  if (!isLower(value.charCodeAt(0)) || !isLower(value.charCodeAt(1))) return false;
  if (value.length === 2) return true;
  return value.charAt(2) === '-' && isUpper(value.charCodeAt(3)) && isUpper(value.charCodeAt(4));
}

/** `[a-z][a-z0-9_]{0,63}` */
export function isParamName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false;
  if (!isLower(value.charCodeAt(0))) return false;
  for (let i = 1; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (!isLower(c) && !isDigit(c) && c !== 95) return false;
  }
  return true;
}

/**
 * Reference into an external secret store: `(aws-sm|aws-ssm|vault)://[A-Za-z0-9/_.+=@-]+`.
 * The frozen schema sets no upper bound; this builder refuses references over 512 characters.
 */
export function isSecretRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_SECRET_REF_LENGTH) return false;
  const prefix = SECRET_REF_PREFIXES.find((p) => value.startsWith(p));
  if (prefix === undefined || value.length === prefix.length) return false;
  return onlyAllowed(value, prefix.length, '/_.+=@-');
}

export function isCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_RE.test(value);
}

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

const TRANSITIONS: Readonly<Record<DispatchStatus, readonly DispatchStatus[]>> = {
  QUEUED: ['SENDING'],
  SENDING: ['SENDING', 'QUEUED', 'SENT', 'FAILED'],
  SENT: ['DELIVERED', 'UNDELIVERED'],
  DELIVERED: [],
  UNDELIVERED: [],
  FAILED: [],
};

export function canTransition(from: DispatchStatus, to: DispatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
