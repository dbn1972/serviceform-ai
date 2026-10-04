export {
  bootstrapObservability,
  observabilityPlugin,
  type ObservabilityPluginOptions,
} from './plugin.js';

export {
  REDACTED,
  SENSITIVE_KEYS,
  createLogger,
  isSensitiveKey,
  pinoRedactPaths,
  redactDeep,
  sanitizeRequestForLog,
  sanitizeUrlForLog,
  startTelemetry,
  type Logger,
  type LoggerConfig,
  type TelemetryConfig,
  type TelemetryHandle,
} from '@serviceform/observability';
