import { errorEntry } from '@serviceform/contracts';

export class Cmp009Error extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: Cmp009Error['details']; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp009Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

export function mapPgError(err: unknown): Cmp009Error {
  const e = err as { code?: string; hint?: string };
  if (e.code === '42501') return new Cmp009Error('SF-TEN-002');
  if (e.code === '23505') return new Cmp009Error('SF-APP-002');
  if (e.code === '23503') return new Cmp009Error('SF-SYS-002');
  if (e.code === '23514') return new Cmp009Error('SF-SYS-003');
  if (e.code === 'P0001' && e.hint === 'SF_RECORD_IMMUTABLE') {
    return new Cmp009Error('SF-SYS-003', { details: [{ code: 'RECORD_IMMUTABLE' }] });
  }
  if (err instanceof Cmp009Error) return err;
  return new Cmp009Error('SF-SYS-001', { cause: err });
}
