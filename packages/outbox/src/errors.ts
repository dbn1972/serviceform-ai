import { errorEntry } from '@serviceform/contracts';

/** Failure mapped to a frozen SF-* catalogue code. */
export class OutboxError extends Error {
  readonly code: string;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: { details?: OutboxError['details']; cause?: unknown; message?: string } = {},
  ) {
    const entry = errorEntry(code);
    super(options.message ?? entry.message, { cause: options.cause });
    this.name = 'OutboxError';
    this.code = code;
    this.details = options.details;
  }
}

export class RegistryError extends OutboxError {
  constructor(
    code: string,
    options: { details?: OutboxError['details']; cause?: unknown; message?: string } = {},
  ) {
    super(code, options);
    this.name = 'RegistryError';
  }
}
