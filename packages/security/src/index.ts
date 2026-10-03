export { InMemoryAuditSink, type AuditSink } from './audit-sink.js';
export { SecurityError } from './errors.js';
export { authorizeAction, isPdpFailure, type AuthzResource } from './pep/authorize.js';
export { CircuitBreaker } from './pep/circuit-breaker.js';
export { sanitizeDecisionLog, type DecisionLogEntry } from './pep/decision-log.js';
export { assertOpaUrl, OpaPdpClient, type PdpClient } from './pep/pdp-client.js';
export {
  AuthzRateLimiter,
  defaultAuthzRateLimit,
  rateLimitAuthorization,
  type AuthzRateLimitConfig,
} from './pep/rate-limit.js';
export { sfSecurity, type SfAuthzConfig, type SfSecurityOptions } from './plugin.js';
export {
  deepFreeze,
  type ContextResolver,
  type PrincipalVerifier,
  type VerifiedPrincipal,
} from './principal.js';
export { LocalKms } from './kms/local-kms.js';
export { canonicalAad, type KmsEnvelope, type KmsProvider } from './kms/kms-provider.js';
export { LocalSecretsProvider } from './secrets/local-secrets-provider.js';
export {
  SECRET_NAME,
  SecretUnavailableError,
  assertLocalEnvironment,
  type SecretRef,
  type SecretsProvider,
} from './secrets/secrets-provider.js';
export { SecretValue } from './secrets/secret-value.js';
