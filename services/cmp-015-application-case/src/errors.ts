/**
 * SF-CON-ERROR-CATALOGUE entries CMP-015 emits. Messages and HTTP statuses must equal the frozen
 * contracts/shared/error-catalogue.json rows (asserted by test/contract). This package declares no
 * workspace dependencies, so it carries the subset it uses instead of importing @serviceform/contracts.
 */
export const ERROR_CATALOGUE = {
  'SF-AUTH-001': { message: 'Authentication required', http: [401] },
  'SF-AUTH-002': { message: 'Insufficient authorization', http: [403] },
  'SF-TEN-001': { message: 'Tenant context missing', http: [400, 401] },
  'SF-TEN-002': { message: 'Cross-tenant operation denied', http: [403] },
  'SF-FORM-001': { message: 'Form/schema version unavailable', http: [409, 422] },
  'SF-APP-001': { message: 'Invalid application state transition', http: [409] },
  'SF-APP-002': { message: 'Duplicate submission / idempotency conflict', http: [409] },
  'SF-WF-001': { message: 'Workflow transition rejected', http: [409] },
  'SF-SYS-001': { message: 'Unexpected server error', http: [500] },
  'SF-SYS-002': { message: 'Resource or route not found', http: [404] },
  'SF-SYS-003': { message: 'Request validation failed', http: [400] },
  'SF-SYS-004': { message: 'Service temporarily unavailable', http: [503] },
} as const satisfies Record<string, { message: string; http: readonly number[] }>;

export type Cmp015ErrorCode = keyof typeof ERROR_CATALOGUE;

export interface ErrorDetail {
  code: string;
  pointer?: string;
  message?: string;
}

export class Cmp015Error extends Error {
  readonly code: Cmp015ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    code: Cmp015ErrorCode,
    options: { statusCode?: number; details?: ErrorDetail[]; cause?: unknown } = {},
  ) {
    const entry = ERROR_CATALOGUE[code];
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp015Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0];
    this.details = options.details;
  }
}

export function detail(code: string, pointer?: string): ErrorDetail[] {
  return pointer === undefined ? [{ code }] : [{ code, pointer }];
}

const PG_HINT_MAP: Record<string, [Cmp015ErrorCode, string]> = {
  SF_INVALID_TRANSITION: ['SF-APP-001', 'ILLEGAL_TRANSITION'],
  SF_STALE_VERSION: ['SF-APP-001', 'STALE_VERSION'],
  SF_REQUEST_NOT_COMMITTED: ['SF-APP-001', 'REQUEST_NOT_COMMITTED'],
  SF_PIN_IMMUTABLE: ['SF-APP-001', 'PIN_IMMUTABLE'],
  SF_RECORD_IMMUTABLE: ['SF-SYS-003', 'RECORD_IMMUTABLE'],
};

/** Maps PostgreSQL failures to catalogue errors without echoing SQL text or row content. */
export function mapPgError(err: unknown): Cmp015Error {
  if (err instanceof Cmp015Error) return err;
  const e = (err ?? {}) as { code?: unknown; hint?: unknown };
  if (e.code === 'P0001' && typeof e.hint === 'string') {
    const mapped = PG_HINT_MAP[e.hint];
    if (mapped) return new Cmp015Error(mapped[0], { details: detail(mapped[1]), cause: err });
  }
  if (e.code === '42501') return new Cmp015Error('SF-TEN-002', { cause: err });
  if (e.code === '23505') return new Cmp015Error('SF-APP-002', { cause: err });
  if (e.code === '23514')
    return new Cmp015Error('SF-APP-001', { details: detail('CHECK_VIOLATION'), cause: err });
  if (e.code === '23503') return new Cmp015Error('SF-SYS-002', { cause: err });
  if (e.code === '40001' || e.code === '40P01') {
    return new Cmp015Error('SF-APP-001', { details: detail('CONCURRENT_UPDATE'), cause: err });
  }
  return new Cmp015Error('SF-SYS-001', { cause: err });
}
