import { randomInt } from 'node:crypto';

export type ErrorClass = 'retryable' | 'fatal';

const RETRYABLE = new Set([
  'BROKER_UNAVAILABLE',
  'TIMEOUT',
  'NOT_LEADER',
  'TOPIC_UNREGISTERED',
  'SCHEMA_VERSION_UNSUPPORTED',
  'DLQ_PUBLISH_FAILED',
]);

export function classifyErrorCode(code: string): ErrorClass {
  return RETRYABLE.has(code) ? 'retryable' : 'fatal';
}

export function backoffMs(attempts: number, baseMs = 250, capMs = 30_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempts));
  const jitter = 0.5 + randomInt(0, 1_000_000) / 1_000_000;
  return Math.min(capMs, Math.floor(exp * jitter));
}
