export { RiskAssessmentService } from './service/risk-assessment-service.js';
export type { AssessmentResult } from './service/risk-assessment-service.js';
export { Cmp060Error, mapPgError } from './errors.js';
export {
  classifyRiskTier,
  requiresHumanReview,
  assertSignalsAreAdvisoryOnly,
} from './domain/risk-classifier.js';
export type {
  RiskLifecycleStatus,
  RiskTier,
  ReviewDisposition,
  RiskSignalInput,
  CreateRiskAssessmentCommand,
  RecordDispositionCommand,
  RiskAssessmentRecord,
} from './domain/types.js';
export { registerRiskRoutes } from './routes/risk-routes.js';
export type { RiskRouteOptions } from './routes/risk-routes.js';
export { assertNoTenantIdentifyingHeaders, requireTenantContext, isUuid } from './context.js';
export type { RequestContext, TenantContext, ContextResolver } from './context.js';
export type { TenantAuthzPort } from './ports/tenant-authz.js';
export { DenyAllTenantAuthz, SimulatedAllowAllTenantAuthz } from './ports/tenant-authz.js';
export type { ReviewRoutingPort } from './ports/review-routing.js';
export { SimulatedReviewRoutingPort } from './ports/review-routing.js';
