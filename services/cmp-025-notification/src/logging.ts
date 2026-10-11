import { findPii } from './domain/pii-guard.js';

/**
 * Structured, allow-listed logging. Only identifiers and codes can be emitted: template parameters,
 * rendered bodies, recipient addresses/handles, secret references and provider payloads have no
 * permitted key, and any string value that looks like PII is redacted.
 */
export const LOG_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  'event',
  'tenant_id',
  'dispatch_id',
  'correlation_id',
  'channel',
  'template_ref',
  'template_version',
  'status',
  'attempt',
  'outcome',
  'error_code',
  'connector_mode',
  'count',
]);

export type LogValue = string | number | boolean | null;
export type LogFields = Readonly<Record<string, LogValue>>;

export interface SafeLogger {
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
}

export function scrubFields(fields: LogFields): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!LOG_FIELD_ALLOWLIST.has(key)) continue;
    out[key] = typeof value === 'string' && findPii(value) !== null ? '[REDACTED]' : value;
  }
  return out;
}

export class NoopLogger implements SafeLogger {
  info(): void {
    /* intentionally silent */
  }
  warn(): void {
    /* intentionally silent */
  }
}

export class RecordingLogger implements SafeLogger {
  readonly lines: Record<string, LogValue>[] = [];
  info(fields: LogFields): void {
    this.lines.push({ level: 'info', ...scrubFields(fields) });
  }
  warn(fields: LogFields): void {
    this.lines.push({ level: 'warn', ...scrubFields(fields) });
  }
}
