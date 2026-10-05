/**
 * SF-* codes used by CMP-016. Values mirror the FROZEN SF-CON-ERROR-CATALOGUE
 * (contracts/shared/error-catalogue.json); test/contract asserts they stay in sync.
 */
export const ERROR_CODES = {
  'SF-AUTH-002': { message: 'Insufficient authorization', http: 403 },
  'SF-TEN-001': { message: 'Tenant context missing', http: 401 },
  'SF-TEN-002': { message: 'Cross-tenant operation denied', http: 403 },
  'SF-APP-002': { message: 'Duplicate submission / idempotency conflict', http: 409 },
  'SF-WF-001': { message: 'Workflow transition rejected', http: 409 },
  'SF-SYS-001': { message: 'Unexpected server error', http: 500 },
  'SF-SYS-002': { message: 'Resource or route not found', http: 404 },
  'SF-SYS-003': { message: 'Request validation failed', http: 400 },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorDetail {
  code: string;
  pointer?: string;
}

export class Cmp016Error extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetail[];

  constructor(code: ErrorCode, details: ErrorDetail[] = [], options: { cause?: unknown } = {}) {
    super(ERROR_CODES[code].message, { cause: options.cause });
    this.name = 'Cmp016Error';
    this.code = code;
    this.statusCode = ERROR_CODES[code].http;
    this.details = details;
  }

  hasDetail(detailCode: string): boolean {
    return this.details.some((d) => d.code === detailCode);
  }
}

export function reject(detailCode: string, pointer?: string): Cmp016Error {
  return new Cmp016Error('SF-WF-001', [
    pointer ? { code: detailCode, pointer } : { code: detailCode },
  ]);
}

export function invalid(detailCode: string, pointer?: string): Cmp016Error {
  return new Cmp016Error('SF-SYS-003', [
    pointer ? { code: detailCode, pointer } : { code: detailCode },
  ]);
}

const PG_HINTS: Record<string, string> = {
  SF_PUBLISHED_IMMUTABLE: 'PUBLISHED_VERSION_IMMUTABLE',
  SF_VERSION_TRANSITION: 'ILLEGAL_VERSION_TRANSITION',
  SF_VERSION_NOT_PUBLISHED: 'VERSION_NOT_PUBLISHED',
  SF_SILENT_REPOINT: 'SILENT_REPOINT_FORBIDDEN',
  SF_MIGRATION_INVALID: 'MIGRATION_INVALID',
  SF_INSTANCE_TERMINAL: 'INSTANCE_TERMINAL',
  SF_RECORD_IMMUTABLE: 'RECORD_IMMUTABLE',
};

export function mapPgError(err: unknown): Cmp016Error {
  if (err instanceof Cmp016Error) return err;
  const e = err as { code?: string; hint?: string };
  if (e.code === 'P0001' && e.hint && PG_HINTS[e.hint]) {
    return new Cmp016Error('SF-WF-001', [{ code: PG_HINTS[e.hint] as string }], { cause: err });
  }
  if (e.code === '42501') return new Cmp016Error('SF-TEN-002', [], { cause: err });
  if (e.code === '23505') return new Cmp016Error('SF-APP-002', [], { cause: err });
  if (e.code === '23503') return new Cmp016Error('SF-SYS-002', [], { cause: err });
  if (e.code === '23514') return new Cmp016Error('SF-SYS-003', [], { cause: err });
  return new Cmp016Error('SF-SYS-001', [], { cause: err });
}
