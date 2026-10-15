/**
 * CMP-060 errors. Maps PG error codes to domain error codes.
 * SF-AI-* codes for AI/risk boundary violations. SF-TEN-* for tenant isolation.
 */

export class Cmp060Error extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: {
      statusCode?: number;
      details?: Cmp060Error['details'];
      cause?: unknown;
    } = {},
  ) {
    const entry = ERROR_CATALOGUE[code] ?? { message: 'Unexpected error', http: [500] };
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp060Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

const ERROR_CATALOGUE: Record<string, { message: string; http: number[] }> = {
  'SF-AI-001': {
    message: 'Advisory boundary violation: AI may not make authoritative decisions',
    http: [422],
  },
  'SF-AI-002': { message: 'Statutory policy invention is forbidden', http: [422] },
  'SF-AI-003': { message: 'Risk score alone must not determine adverse outcome', http: [422] },
  'SF-TEN-001': { message: 'Authentication required', http: [401] },
  'SF-TEN-002': { message: 'Tenant isolation violation', http: [403] },
  'SF-APP-002': { message: 'Duplicate idempotency key', http: [409] },
  'SF-SYS-001': { message: 'Internal error', http: [500] },
  'SF-SYS-002': { message: 'Referenced entity not found', http: [422] },
  'SF-SYS-003': { message: 'Constraint violation', http: [422] },
  'SF-INT-001': { message: 'Integration contract violation', http: [422] },
};

export function mapPgError(err: unknown): Cmp060Error {
  if (err instanceof Cmp060Error) return err;
  const e = err as { code?: string; hint?: string; message?: string };
  if (e.code === '42501') return new Cmp060Error('SF-TEN-002');
  if (e.code === '23505') return new Cmp060Error('SF-APP-002');
  if (e.code === '23503') return new Cmp060Error('SF-SYS-002');
  if (e.code === '23514')
    return new Cmp060Error('SF-AI-001', {
      details: [{ code: 'AUTHORITATIVE_DECISION_BLOCKED' }],
    });
  if (e.code === '55000' && e.message?.includes('authoritative_decision_by_this_component')) {
    return new Cmp060Error('SF-AI-001', {
      details: [{ code: 'AUTHORITATIVE_DECISION_BLOCKED' }],
    });
  }
  return new Cmp060Error('SF-SYS-001', { cause: err });
}
