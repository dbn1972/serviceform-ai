import { errorEntry } from '../../../packages/contracts/src/index.js';

export class Cmp050Error extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: Cmp050Error['details']; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'Cmp050Error';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

export function errorBody(
  correlationId: string,
  err: Cmp050Error,
): {
  error_code: string;
  message: string;
  correlation_id: string;
  details?: Cmp050Error['details'];
} {
  const body: {
    error_code: string;
    message: string;
    correlation_id: string;
    details?: Cmp050Error['details'];
  } = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body.details = err.details;
  return body;
}
