import { createNotificationApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import type { DeploymentEnvironment } from './domain/model.js';
import { Cmp025Error } from './errors.js';
import type { SafeLogger } from './logging.js';
import type { ChannelConnectorRegistry } from './ports/channel-connector.js';
import {
  UnboundConnectorBindingPort,
  type ConnectorBindingPort,
} from './ports/connector-binding-port.js';
import {
  UnboundRecipientDirectoryPort,
  type RecipientDirectoryPort,
} from './ports/recipient-directory-port.js';
import { PgNotificationRepository, type SqlPool } from './repo/pg.js';
import type { NotificationRepository } from './repo/types.js';
import { NotificationDeliveryWorker } from './service/delivery.js';
import { NotificationService } from './service/service.js';

export interface NotificationOptions {
  pool?: SqlPool;
  repository?: NotificationRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  /** Deployment environment of this runtime. Required: there is no implicit default. */
  environment: DeploymentEnvironment;
  /** Adapters. A missing registry fails every dispatch closed (CONNECTOR_NOT_BOUND). */
  connectors?: ChannelConnectorRegistry;
  bindings?: ConnectorBindingPort;
  recipients?: RecipientDirectoryPort;
  testRunId?: string;
  logger?: SafeLogger;
  sendTimeoutMs?: number;
  workerId?: string;
  clock?: () => Date;
}

const NO_ADAPTERS: ChannelConnectorRegistry = { forBinding: () => null };

export function buildNotificationService(
  opts: Omit<NotificationOptions, 'resolveContext'>,
): NotificationService {
  const repo = opts.repository ?? (opts.pool ? new PgNotificationRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp025Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new NotificationService({
    repo,
    authorizer: opts.authorizer,
    bindings: opts.bindings ?? new UnboundConnectorBindingPort(),
    recipients: opts.recipients ?? new UnboundRecipientDirectoryPort(),
    connectors: opts.connectors ?? NO_ADAPTERS,
    environment: opts.environment,
    ...(opts.testRunId === undefined ? {} : { testRunId: opts.testRunId }),
    ...(opts.logger === undefined ? {} : { logger: opts.logger }),
    ...(opts.sendTimeoutMs === undefined ? {} : { sendTimeoutMs: opts.sendTimeoutMs }),
    ...(opts.workerId === undefined ? {} : { workerId: opts.workerId }),
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildNotificationApi(
  opts: NotificationOptions,
): ReturnType<typeof createNotificationApi> {
  return createNotificationApi({
    service: buildNotificationService(opts),
    resolveContext: opts.resolveContext,
  });
}

export function buildDeliveryWorker(
  opts: Omit<NotificationOptions, 'resolveContext'>,
): NotificationDeliveryWorker {
  return new NotificationDeliveryWorker(buildNotificationService(opts));
}

export { NotificationService } from './service/service.js';
export { NotificationDeliveryWorker } from './service/delivery.js';
export type { DeliverySummary } from './service/delivery.js';
export { createNotificationApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgNotificationRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export { DefaultConnectorRegistry } from './connectors/registry.js';
export { SimulatedChannelConnector } from './connectors/simulated-channel.js';
export { HubChannelConnector } from './connectors/hub-channel.js';
export type {
  HubTransport,
  HubDeliveryRequest,
  HubDeliveryResponse,
} from './connectors/hub-channel.js';
export type { ChannelConnector, ChannelConnectorRegistry } from './ports/channel-connector.js';
export type { ConnectorBindingPort } from './ports/connector-binding-port.js';
export type { RecipientDirectoryPort } from './ports/recipient-directory-port.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { SafeLogger } from './logging.js';
