import type { AuditEvent } from '@serviceform/contracts';
import { AuditSinkUnavailableError } from './errors.js';

export interface HttpAuditSinkOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  delayMs?: number;
}

export interface AuditAppendResult {
  audit_id: string;
  chain_seq: number;
  recorded_at: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class HttpAuditSink {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly delayMs: number;

  constructor(opts: HttpAuditSinkOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retries = opts.retries ?? 3;
    this.delayMs = opts.delayMs ?? 10;
  }

  async submit(event: AuditEvent, correlationId: string): Promise<AuditAppendResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/v1/internal/audit-events`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify(event),
        });
        if (res.status === 200 || res.status === 201) {
          return (await res.json()) as AuditAppendResult;
        }
        if (res.status === 503) {
          lastError = new AuditSinkUnavailableError();
          await sleep(this.delayMs * (attempt + 1));
          continue;
        }
        throw new AuditSinkUnavailableError(`HTTP ${String(res.status)}`);
      } catch (err) {
        lastError = err;
        if (err instanceof AuditSinkUnavailableError && attempt < this.retries - 1) {
          await sleep(this.delayMs * (attempt + 1));
          continue;
        }
        if (attempt < this.retries - 1) {
          await sleep(this.delayMs * (attempt + 1));
          continue;
        }
      }
    }
    throw lastError instanceof AuditSinkUnavailableError
      ? lastError
      : new AuditSinkUnavailableError();
  }
}
