import { AuditError } from './errors.js';

export function assertClock(occurredAt: string, now: Date, skewSeconds: number): void {
  const occurred = Date.parse(occurredAt);
  if (!Number.isFinite(occurred)) {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'CLOCK_SKEW', message: 'occurred_at is not a timestamp' }],
    });
  }
  if (occurred > now.getTime() + skewSeconds * 1000) {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'CLOCK_SKEW', message: 'occurred_at exceeds allowed skew' }],
    });
  }
}
