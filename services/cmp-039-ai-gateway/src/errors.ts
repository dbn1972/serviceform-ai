import { errorEntry } from '@serviceform/contracts';

export class Cmp039Error extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: Cmp039Error['details']; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp039Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

export function mapPgError(err: unknown): Cmp039Error {
  if (err instanceof Cmp039Error) return err;
  const e = err as { code?: string; hint?: string };
  if (e.code === '42501') return new Cmp039Error('SF-TEN-002');
  if (e.code === '23505') return new Cmp039Error('SF-APP-002');
  if (e.code === '23503') return new Cmp039Error('SF-SYS-002');
  if (e.code === '23514') return new Cmp039Error('SF-SYS-003');
  if (e.code === 'P0001' && e.hint === 'SF_PUBLISHED_IMMUTABLE') {
    return new Cmp039Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
  }
  return new Cmp039Error('SF-SYS-001', { cause: err });
}
