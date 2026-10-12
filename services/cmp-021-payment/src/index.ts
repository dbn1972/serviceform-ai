import { createPaymentApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp021Error } from './errors.js';
import {
  UnboundConnectorBindingPort,
  type ConnectorBindingPort,
} from './ports/connector-binding-port.js';
import { UnboundFeeQuotePort, type FeeQuotePort } from './ports/fee-quote-port.js';
import {
  UnboundPaymentGatewayPort,
  type PaymentGatewayPort,
} from './ports/payment-gateway-port.js';
import { NoOpWorkflowSignalPort, type WorkflowSignalPort } from './ports/workflow-signal-port.js';
import { PgPaymentRepository, type SqlPool } from './repo/pg.js';
import type { PaymentRepository } from './repo/types.js';
import { PaymentService } from './service/service.js';
import type { DeploymentEnvironment } from './types.js';

export interface PaymentOptions {
  pool?: SqlPool;
  repository?: PaymentRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  feeQuote?: FeeQuotePort;
  connectorBinding?: ConnectorBindingPort;
  gateway?: PaymentGatewayPort;
  workflowSignal?: WorkflowSignalPort;
  runtimeEnvironment?: DeploymentEnvironment;
  clock?: () => Date;
}

/** Unbound ports fail closed (SF-INT-001 / SF-SYS-004). No default PSP binding or amount. */
export function buildPaymentService(opts: Omit<PaymentOptions, 'resolveContext'>): PaymentService {
  const repo = opts.repository ?? (opts.pool ? new PgPaymentRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp021Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new PaymentService({
    repo,
    authorizer: opts.authorizer,
    feeQuote: opts.feeQuote ?? new UnboundFeeQuotePort(),
    connectorBinding: opts.connectorBinding ?? new UnboundConnectorBindingPort(),
    gateway: opts.gateway ?? new UnboundPaymentGatewayPort(),
    workflowSignal: opts.workflowSignal ?? new NoOpWorkflowSignalPort(),
    runtimeEnvironment: opts.runtimeEnvironment ?? 'LOCAL',
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildPaymentApi(opts: PaymentOptions): ReturnType<typeof createPaymentApi> {
  return createPaymentApi({
    service: buildPaymentService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { PaymentService } from './service/service.js';
export { createPaymentApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgPaymentRepository } from './repo/pg.js';
export { SimulatedPspConnector } from './connectors/simulated-psp.js';
export { HubPspConnector } from './connectors/hub-psp.js';
export { intentView } from './domain/intent-view.js';
export { callbackView } from './domain/callback-view.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { FeeQuotePort, FeeQuoteView } from './ports/fee-quote-port.js';
export type { ConnectorBindingPort } from './ports/connector-binding-port.js';
export type {
  PaymentGatewayPort,
  GatewaySessionRequest,
  GatewaySessionResult,
  GatewayCallbackPayload,
  GatewayCallbackResult,
} from './ports/payment-gateway-port.js';
export type { WorkflowSignalPort } from './ports/workflow-signal-port.js';
export type { ConnectorBindingView, SimulationMarker } from './domain/simulation.js';
