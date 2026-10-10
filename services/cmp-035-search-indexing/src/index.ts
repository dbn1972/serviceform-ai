export { SearchQueryService, hitOf } from './service.js';
export type { SearchHit, SearchServiceDeps, ServiceResult } from './service.js';
export { SearchIndexConsumer } from './indexer.js';
export type {
  DocumentChangeData,
  IndexDelivery,
  IndexOutcome,
  IndexerDeps,
  SkipReason,
} from './indexer.js';
export {
  createSearchRoutes,
  errorResponse,
  registerSearchRoutes,
  type SearchHttpOptions,
  type ContextResolver,
  type HttpRequestLike,
  type HttpResponse,
  type ReplyLike,
  type RouteDefinition,
  type RouteRegistrar,
} from './http.js';
export { loadConfig, assertPortAllowed, type Cmp035Config } from './config.js';
export { Cmp035Error, ERROR_CATALOGUE, mapPgError } from './errors.js';
export {
  PgSearchStore,
  type SqlClient,
  type SqlPool,
  type SqlQueryResult,
} from './store/pg-store.js';
export type {
  DbSession,
  DocumentQuery,
  DocumentStatus,
  DocumentUpdate,
  SearchDocumentRow,
  SearchStore,
  SearchTx,
} from './store/types.js';
export { guardOutboundPort, inDomainTransaction, runInDomainTransaction } from './tx-scope.js';
export * from './domain/document.js';
export * from './domain/projection.js';
export { parseSearchQuery, type SearchQuery } from './domain/query.js';
export { denyAllAuthorization, type AuthorizationPort } from './ports/authorization.js';
export {
  noProjectionRules,
  SimulatedProjectionRules,
  type ProjectionRuleLookup,
  type ProjectionRulePort,
} from './ports/projection-rules.js';
export {
  TOPIC_AUDIT,
  TOPIC_DOMAIN,
  EVENT_TYPES,
  INDEXER_CONSUMER_GROUP,
  type EventContext,
} from './events.js';
export { ACTIONS } from './authz.js';
