export class StoragePortError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoragePortError';
    this.code = code;
  }
}
