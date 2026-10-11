/**
 * SF-CON-ERROR-CATALOGUE entries CMP-026 emits. Messages and HTTP statuses equal the frozen
 * contracts/shared/error-catalogue.json rows. No new catalogue codes (19 frozen contracts).
 */
export const ERROR_CATALOGUE = {
  'SF-AUTH-001': { message: 'Authentication required', http: [401] },
  'SF-AUTH-002': { message: 'Insufficient authorization', http: [403] },
  'SF-TEN-001': { message: 'Tenant context missing', http: [400, 401] },
  'SF-TEN-002': { message: 'Cross-tenant operation denied', http: [403] },
  'SF-APP-001': { message: 'Invalid application state transition', http: [409] },
  'SF-APP-002': { message: 'Duplicate submission / idempotency conflict', http: [409] },
  'SF-SYS-001': { message: 'Unexpected server error', http: [500] },
  'SF-SYS-002': { message: 'Resource or route not found', http: [404] },
  'SF-SYS-003': { message: 'Request validation failed', http: [400] },
  'SF-SYS-004': { message: 'Service temporarily unavailable', http: [503] },
} as const satisfies Record<string, { message: string; http: readonly number[] }>;

export type Cmp026ErrorCode = keyof typeof ERROR_CATALOGUE;

export interface ErrorDetail {
  code: string;
  pointer?: string;
  message?: string;
}

export class Cmp026Error extends Error {
  readonly code: Cmp026ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    code: Cmp026ErrorCode,
    options: { statusCode?: number; details?: ErrorDetail[]; cause?: unknown } = {},
  ) {
    const entry = ERROR_CATALOGUE[code];
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp026Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0];
    this.details = options.details;
  }
}

export function detail(code: string, pointer?: string): ErrorDetail[] {
  return pointer === undefined ? [{ code }] : [{ code, pointer }];
}

const PG_HINT_MAP: Record<string, [Cmp026ErrorCode, string]> = {
  SF_INVALID_TRANSITION: ['SF-APP-001', 'ILLEGAL_TRANSITION'],
  SF_STALE_VERSION: ['SF-APP-001', 'STALE_VERSION'],
  SF_RECORD_IMMUTABLE: ['SF-SYS-003', 'RECORD_IMMUTABLE'],
  SF_THREAD_NOT_OPEN: ['SF-APP-001', 'THREAD_NOT_OPEN'],
  SF_NOT_PARTICIPANT: ['SF-AUTH-002', 'NOT_PARTICIPANT'],
};

export function mapPgError(err: unknown): Cmp026Error {
  if (err instanceof Cmp026Error) return err;
  const e = (err ?? {}) as { code?: unknown; hint?: unknown };
  if (e.code === 'P0001' && typeof e.hint === 'string') {
    const mapped = PG_HINT_MAP[e.hint];
    if (mapped) return new Cmp026Error(mapped[0], { details: detail(mapped[1]), cause: err });
  }
  if (e.code === '42501') return new Cmp026Error('SF-TEN-002', { cause: err });
  if (e.code === '23505') return new Cmp026Error('SF-APP-002', { cause: err });
  if (e.code === '23514')
    return new Cmp026Error('SF-APP-001', { details: detail('CHECK_VIOLATION'), cause: err });
  if (e.code === '23503') return new Cmp026Error('SF-SYS-002', { cause: err });
  if (e.code === '40001' || e.code === '40P01') {
    return new Cmp026Error('SF-APP-001', { details: detail('CONCURRENT_UPDATE'), cause: err });
  }
  return new Cmp026Error('SF-SYS-001', { cause: err });
}
