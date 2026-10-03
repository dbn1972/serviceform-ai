import { errorEntry } from '@serviceform/contracts';

export class SecurityError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: SecurityError['details']; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'SecurityError';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}
