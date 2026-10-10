export {
  buildRecommendationService,
  recommendationPlugin,
  registerRecommendation,
  type RecommendationPluginOptions,
} from './plugin.js';
export type { AuthorizationPort } from './authz.js';
export { Cmp007Error } from './errors.js';
export type { AiGatewayPort, GatewayInvokeResult } from './ports/gateway-port.js';
export type { CataloguePort, CatalogueCandidate } from './ports/catalogue-port.js';
export type { ConsentPort, ConsentCheck } from './ports/consent-port.js';
export type { ProfileSignalPort } from './ports/profile-port.js';
export { PgRecommendationRepository } from './repo/pg.js';
export type { RecommendationRepository, RecommendationTx } from './repo/types.js';
export {
  RecommendationService,
  type RecommendationView,
} from './service/recommendation-service.js';
export { TOPIC_DOMAIN, TOPIC_AUDIT, DOMAIN_EVENT_TYPES } from './outbox.js';
export { canTransition } from './domain/states.js';
export { namesBindingOutcome, isValidReasonCode } from './domain/guard.js';
export { parseGatewayOutput } from './domain/parse-output.js';
