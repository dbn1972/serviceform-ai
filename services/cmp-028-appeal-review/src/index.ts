export {
  AppealService,
  type Idempotency,
  type ServiceResult,
  type AppealServiceDeps,
} from './service/appeal-service.js';
export {
  createAppealHandler,
  type HandlerDeps,
  type HttpRequest,
  type HttpResponse,
} from './http/handler.js';
export { PgAppealRepository } from './repo/pg.js';
export type { AppealRepository } from './repo/types.js';
export { denyAllAuthz, type AuthorizationPort } from './authz.js';
export type { SqlPool, SqlClient, SqlQueryable } from './sql.js';
export { Cmp028Error } from './errors.js';
export { parseAuthority, type AppellateAuthority } from './domain/authority.js';
export type { CaseCommandPort } from './ports/case-command.js';
export type { WorkflowLinkPort } from './ports/workflow.js';
export { inDomainTransaction, guardOutboundPort } from './tx-scope.js';
