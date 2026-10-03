export class AuditClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuditClientError';
    this.code = code;
  }
}

export class AuditSinkUnavailableError extends AuditClientError {
  constructor(message = 'Audit sink unavailable') {
    super('SF-SYS-004', message);
    this.name = 'AuditSinkUnavailableError';
  }
}

export class PiiRejectedError extends AuditClientError {
  readonly pointer: string;
  readonly detector: string;

  constructor(pointer: string, detector: string) {
    super('SF-SYS-003', 'Request validation failed');
    this.name = 'PiiRejectedError';
    this.pointer = pointer;
    this.detector = detector;
  }
}
