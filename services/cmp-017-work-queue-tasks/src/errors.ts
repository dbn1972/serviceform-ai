import { errorEntry } from './contracts.js';

export interface ErrorDetailView {
  code: string;
  pointer?: string;
  message?: string;
}

export class Cmp017Error extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: ErrorDetailView[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: ErrorDetailView[]; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp017Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

export function detail(code: string, pointer?: string): { details: ErrorDetailView[] } {
  return { details: [pointer ? { code, pointer } : { code }] };
}

/** Maps database failures to catalogue codes without echoing driver text. */
export function mapPgError(err: unknown): Cmp017Error {
  if (err instanceof Cmp017Error) return err;
  const e = err as { code?: string };
  if (e.code === '42501') return new Cmp017Error('SF-TEN-002');
  if (e.code === '23505') return new Cmp017Error('SF-APP-002');
  if (e.code === '23503') return new Cmp017Error('SF-SYS-002');
  if (e.code === '23514') return new Cmp017Error('SF-SYS-003');
  if (e.code === 'P0001') return new Cmp017Error('SF-APP-001', detail('TASK_STATE_CONFLICT'));
  return new Cmp017Error('SF-SYS-001', { cause: err });
}
