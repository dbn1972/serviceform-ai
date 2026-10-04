export class ConnectorSdkError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConnectorSdkError';
    this.code = code;
  }
}

export class BindingInvalidError extends ConnectorSdkError {
  constructor(message = 'Connector binding is invalid') {
    super('BINDING_INVALID', message);
    this.name = 'BindingInvalidError';
  }
}

export class ConnectorModeForbiddenError extends ConnectorSdkError {
  constructor(message = 'Connector mode is forbidden in this environment') {
    super('CONNECTOR_MODE_FORBIDDEN', message);
    this.name = 'ConnectorModeForbiddenError';
  }
}

export class ProductionSimulatedCriticalConnectorError extends ConnectorSdkError {
  constructor(message = 'Production refuses a non-REAL connector binding') {
    super('CONNECTOR_MODE_FORBIDDEN', message);
    this.name = 'ProductionSimulatedCriticalConnectorError';
  }
}

export class OutboundCallInTransactionError extends ConnectorSdkError {
  constructor() {
    super(
      'OUTBOUND_IN_TX',
      'Outbound connector call attempted inside an open database transaction',
    );
    this.name = 'OutboundCallInTransactionError';
  }
}

export class CircuitOpenError extends ConnectorSdkError {
  constructor() {
    super('CIRCUIT_OPEN', 'Connector circuit is open');
    this.name = 'CircuitOpenError';
  }
}

export class SsrfBlockedError extends ConnectorSdkError {
  constructor(message = 'Outbound target is not allowed') {
    super('SSRF_BLOCKED', message);
    this.name = 'SsrfBlockedError';
  }
}
