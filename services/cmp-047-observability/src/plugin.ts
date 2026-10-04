import {
  createLogger,
  sanitizeUrlForLog,
  startTelemetry,
  type Logger,
  type LoggerConfig,
  type TelemetryConfig,
  type TelemetryHandle,
} from '@serviceform/observability';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface ObservabilityPluginOptions {
  logger: Logger;
  /** When true, emit a redacted access line after every response (path only). */
  accessLog?: boolean;
}

/**
 * CMP-047 Fastify slice: enforces redacted access logging on the host.
 * Domain audit remains CMP-031; this never records bodies, secrets or PII keys.
 */
export const observabilityPlugin = fp(
  async (app: FastifyInstance, opts: ObservabilityPluginOptions) => {
    if (opts.accessLog === false) return;
    app.addHook('onResponse', async (request, reply) => {
      request.log.info(
        {
          req: { id: request.id, method: request.method, url: sanitizeUrlForLog(request.url) },
          res: { statusCode: reply.statusCode },
        },
        'request completed',
      );
    });
  },
  { name: 'cmp-047-observability', fastify: '5.x' },
);

export function bootstrapObservability(config: {
  logger: LoggerConfig;
  telemetry: TelemetryConfig;
}): { logger: Logger; telemetry: TelemetryHandle } {
  // Telemetry must start before HTTP module patching in the process entrypoint.
  const telemetry = startTelemetry(config.telemetry);
  const logger = createLogger(config.logger);
  return { logger, telemetry };
}
