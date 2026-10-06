export { GrievanceFeedbackService, ENDPOINTS, parseIdempotencyKey } from './service.js';
export type { GrievanceServiceDeps, ServiceResult } from './service.js';
export {
  createGrievanceRoutes,
  errorResponse,
  registerGrievanceRoutes,
  type GrievanceHttpOptions,
  type ContextResolver,
  type HttpRequestLike,
  type HttpResponse,
  type ReplyLike,
  type RouteDefinition,
  type RouteRegistrar,
} from './http.js';
export { loadConfig, assertPortAllowed, type Cmp027Config } from './config.js';
export { Cmp027Error, ERROR_CATALOGUE, mapPgError } from './errors.js';
export {
  PgGrievanceStore,
  type SqlClient,
  type SqlPool,
  type SqlQueryResult,
} from './store/pg-store.js';
export type {
  GrievanceStore,
  GrievanceTx,
  GrievanceRow,
  TransitionRow,
  DbSession,
} from './store/types.js';
export { guardOutboundPort, inDomainTransaction, runInDomainTransaction } from './tx-scope.js';
export * from './domain/model.js';
export { denyAllAuthorization, type AuthorizationPort } from './ports/authorization.js';
export {
  OutboxOnlyWorkflowAdvance,
  NoopHumanTaskPort,
  DenyRoutingPolicyPort,
  AllowLinkagePolicyPort,
  type WorkflowAdvancePort,
  type HumanTaskPort,
  type RoutingPolicyPort,
  type LinkagePolicyPort,
  type NotificationPort,
} from './ports/external.js';
export { TOPIC_AUDIT, TOPIC_DOMAIN, EVENT_TYPES } from './events.js';
