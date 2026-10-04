import { errorEntry, type ErrorDetail } from '@serviceform/contracts';

export class AuditError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: ErrorDetail[]; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'AuditError';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

export class DuplicateContentError extends AuditError {
  readonly auditId: string;
  constructor(auditId: string) {
    super('SF-APP-002', { statusCode: 409 });
    this.auditId = auditId;
  }
}
