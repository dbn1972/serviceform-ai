/**
 * Post-commit workflow signal port (INT-007). Called AFTER the payment commit is durable.
 * Failures here must NOT roll back the payment. Retries are at-least-once on the signal side.
 * Default implementation is a safe no-op; host wires Temporal later.
 */
export interface WorkflowSignalPort {
  signalPaymentVerified(params: {
    tenantId: string;
    paymentIntentId: string;
    applicationId: string;
    correlationId: string;
  }): Promise<void>;
}

export class NoOpWorkflowSignalPort implements WorkflowSignalPort {
  signalPaymentVerified(): Promise<void> {
    return Promise.resolve();
  }
}
