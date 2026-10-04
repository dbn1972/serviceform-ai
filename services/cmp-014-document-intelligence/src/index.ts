export {
  buildIntelligenceService,
  documentIntelligencePlugin,
  registerDocumentIntelligence,
  type DocumentIntelligencePluginOptions,
} from './plugin.js';
export type { AuthorizationPort } from './authz.js';
export { Cmp014Error } from './errors.js';
export type { OcrPort, OcrOutcome } from './ports/ocr-port.js';
export type { AiGatewayPort, GatewayInvokeResult } from './ports/gateway-port.js';
export type { SourceDocumentPort, SourceAclPort, SourceDocument } from './ports/source-port.js';
export { SimulatedOcrAdapter } from './adapters/simulated-ocr.js';
export { PgDocIntelRepository } from './repo/pg.js';
export type { DocIntelRepository, DocIntelTx } from './repo/types.js';
export { IntelligenceService, type JobView } from './service/intelligence-service.js';
export { TOPIC_DOMAIN, TOPIC_AUDIT, DOMAIN_EVENT_TYPES } from './outbox.js';
export { canTransition } from './domain/states.js';
export { assertSimulationPolicy } from './domain/simulation.js';
export { redactText } from './domain/redaction.js';
