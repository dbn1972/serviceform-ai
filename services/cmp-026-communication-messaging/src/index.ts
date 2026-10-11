export {
  MessagingService,
  ENDPOINTS,
  parseIdempotencyKey,
  messageThreadContract,
} from './service.js';
export type { MessagingServiceDeps, ServiceResult } from './service.js';
export {
  createMessagingRoutes,
  errorResponse,
  registerMessagingRoutes,
  type MessagingHttpOptions,
  type ContextResolver,
  type HttpRequestLike,
  type HttpResponse,
  type ReplyLike,
  type RouteDefinition,
  type RouteRegistrar,
} from './http.js';
export { loadConfig, assertPortAllowed, type Cmp026Config } from './config.js';
export { Cmp026Error, ERROR_CATALOGUE, mapPgError } from './errors.js';
export {
  PgMessagingStore,
  type SqlClient,
  type SqlPool,
  type SqlQueryResult,
} from './store/pg-store.js';
export type {
  MessagingStore,
  MessagingTx,
  ThreadRow,
  ParticipantRow,
  MessageRow,
  AttachmentRow,
  DbSession,
} from './store/types.js';
export { guardOutboundPort, inDomainTransaction, runInDomainTransaction } from './tx-scope.js';
export * from './domain/model.js';
export { denyAllAuthorization, type AuthorizationPort } from './ports/authorization.js';
export {
  DenyCaseParticipationPort,
  OutboxOnlyWorkflowSignal,
  unconfiguredAttachmentStorage,
  type AttachmentStoragePort,
  type CaseParticipationPort,
  type WorkflowSignalPort,
} from './ports/external.js';
export { SimulatedAttachmentStorage, SimulatedCaseParticipation } from './ports/simulated.js';
export { TOPIC_AUDIT, TOPIC_DOMAIN, EVENT_TYPES } from './events.js';
