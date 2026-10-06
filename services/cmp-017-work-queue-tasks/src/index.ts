export {
  TaskService,
  type Idempotency,
  type ServiceResult,
  type TaskServiceDeps,
} from './service/task-service.js';
export {
  createTaskHandler,
  type HandlerDeps,
  type HttpRequest,
  type HttpResponse,
} from './http/handler.js';
export { PgTaskRepository } from './repo/pg.js';
export type { TaskRepository } from './repo/types.js';
export { denyAllAuthz, type AuthorizationPort } from './authz.js';
export { contextOnlyScope, type PrincipalScopePort } from './ports/principal-scope.js';
export type { SqlPool, SqlClient, SqlQueryable } from './sql.js';
export { Cmp017Error } from './errors.js';
export { parseAssignment, type Assignment } from './domain/assignment.js';
export { matchesAssignment, mismatches, scopeFromContext } from './domain/resolution.js';
