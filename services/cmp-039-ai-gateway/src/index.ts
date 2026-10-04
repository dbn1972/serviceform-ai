export {
  registerAiGateway,
  aiGatewayPlugin,
  authorize,
  denyAllAuthz,
  type AuthorizationPort,
  type PurposeConsentPort,
  type SourceAclPort,
  type ProviderRegistry,
  type AiGatewayPluginOptions,
} from './plugin.js';
export { loadConfig, type AiGatewayConfig } from './config.js';
export { Cmp039Error, mapPgError } from './errors.js';
export {
  SimulatedModelProvider,
  buildProviderRegistry,
  type ModelProviderPort,
  type SimulatedScenario,
} from './ports/provider.js';
export {
  SimulatedPurposeConsentPort,
  SimulatedSourceAclPort,
  denyAllPurposeConsent,
  denyAllSourceAcl,
} from './ports/policy-ports.js';
export { redactText, containsSensitive } from './domain/redaction.js';
export { TOPIC_DOMAIN, envelopeOf, insertOutbox } from './db/outbox.js';
