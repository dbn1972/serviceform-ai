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
export const TEMPLATE_REF_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
export const LOCALE_RE = /^(?:[a-z]{2}|[a-z]{2}-[A-Z]{2})$/;
export const HANDLE_REF_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
export const PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const SECRET_REF_RE = /^(aws-sm|aws-ssm|vault):\/\/[A-Za-z0-9/_.+=@-]+$/;

export const DEFAULT_MAX_ATTEMPTS = 5;
export const LEASE_MS = 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60_000;

/** Deterministic exponential backoff (no jitter) so retries are reproducible under a test clock. */
export function backoffMs(attemptsSoFar: number): number {
  const exp = Math.max(0, attemptsSoFar - 1);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exp);
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
