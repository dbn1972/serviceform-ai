export const ERROR_CATALOGUE_SUBSET = {
  'SF-AUTH-001': { message: 'Authentication required', http: 401 },
  'SF-AUTH-002': { message: 'Insufficient authorization', http: 403 },
  'SF-TEN-001': { message: 'Tenant context missing', http: 401 },
  'SF-TEN-002': { message: 'Cross-tenant operation denied', http: 403 },
  'SF-APP-001': { message: 'Invalid application state transition', http: 409 },
  'SF-APP-002': { message: 'Duplicate submission / idempotency conflict', http: 409 },
  'SF-INT-001': { message: 'External integration temporarily unavailable', http: 503 },
  'SF-SYS-001': { message: 'Unexpected server error', http: 500 },
  'SF-SYS-002': { message: 'Resource or route not found', http: 404 },
  'SF-SYS-003': { message: 'Request validation failed', http: 400 },
  'SF-SYS-004': { message: 'Service temporarily unavailable', http: 503 },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOGUE_SUBSET;

export interface ErrorDetailView {
  code: string;
  pointer?: string;
  message?: string;
}

export class Cmp046Error extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetailView[] | undefined;

  constructor(code: ErrorCode, options: { details?: ErrorDetailView[]; cause?: unknown } = {}) {
    const entry = ERROR_CATALOGUE_SUBSET[code];
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp046Error';
    this.code = code;
    this.statusCode = entry.http;
    this.details = options.details;
  }
}

export function detail(code: string, pointer?: string): { details: ErrorDetailView[] } {
  return { details: [pointer === undefined ? { code } : { code, pointer }] };
}

export function mapPgError(err: unknown): Cmp046Error {
  if (err instanceof Cmp046Error) return err;
  const e = err as { code?: string };
  if (e.code === '42501') return new Cmp046Error('SF-TEN-002');
  if (e.code === '23505') return new Cmp046Error('SF-APP-002');
  if (e.code === '23503') return new Cmp046Error('SF-SYS-002');
  if (e.code === '23514') return new Cmp046Error('SF-SYS-003');
  if (e.code === 'P0001') return new Cmp046Error('SF-APP-001');
  return new Cmp046Error('SF-SYS-001', { cause: err });
}
