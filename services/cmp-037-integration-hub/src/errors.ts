import { errorEntry } from '@serviceform/contracts';

export class HubError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: { code: string; pointer?: string; message?: string }[] | undefined;

  constructor(
    code: string,
    options: { statusCode?: number; details?: HubError['details']; cause?: unknown } = {},
  ) {
    const entry = errorEntry(code);
    super(entry.message, { cause: options.cause });
    this.name = 'HubError';
    this.code = code;
    this.statusCode = options.statusCode ?? entry.http[0] ?? 500;
    this.details = options.details;
  }
}

export function hubError(code: string, detail?: string, statusCode?: number): HubError {
  return new HubError(code, {
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(detail ? { details: [{ code: detail }] } : {}),
  });
}
