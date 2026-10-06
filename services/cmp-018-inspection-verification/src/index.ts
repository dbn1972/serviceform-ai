export {
  InspectionService,
  type Idempotency,
  type ServiceResult,
  type InspectionServiceDeps,
} from './service/inspection-service.js';
export {
  createInspectionHandler,
  type HandlerDeps,
  type HttpRequest,
  type HttpResponse,
} from './http/handler.js';
export { PgInspectionRepository } from './repo/pg.js';
export type { InspectionRepository } from './repo/types.js';
export { denyAllAuthz, type AuthorizationPort } from './authz.js';
export { contextOnlyScope, type PrincipalScopePort } from './ports/principal-scope.js';
export { noopCaseCommand, type CaseCommandPort } from './ports/case-command.js';
export type { EvidencePort } from './ports/evidence.js';
export type { OcrPort } from './ports/ocr.js';
export type { DigiLockerPort } from './ports/digilocker.js';
export type { SqlPool, SqlClient, SqlQueryable } from './sql.js';
export { Cmp018Error } from './errors.js';
export { parseAssignment, type Assignment } from './domain/assignment.js';
export { matchesAssignment, mismatches, scopeFromContext } from './domain/resolution.js';
export { assertSimulationPolicy } from './domain/simulation.js';
export { parseVerificationResult } from './domain/result.js';
