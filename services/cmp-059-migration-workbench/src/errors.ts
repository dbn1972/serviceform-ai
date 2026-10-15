import { errorEntry } from '@serviceform/contracts';

export class Cmp059Error extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: Cmp059Error['details']; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp059Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

export function mapPgError(err: unknown): Cmp059Error {
  const e = err as { code?: string; hint?: string };
  if (e.code === '42501') return new Cmp059Error('SF-TEN-002');
  if (e.code === '23505') return new Cmp059Error('SF-APP-002');
  if (e.code === '23503') return new Cmp059Error('SF-SYS-002');
  if (e.code === '23514') return new Cmp059Error('SF-SYS-003');
  if (err instanceof Cmp059Error) return err;
  return new Cmp059Error('SF-SYS-001', { cause: err });
}
