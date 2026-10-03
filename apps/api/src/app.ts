import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import type { Logger } from '@serviceform/observability';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import type { AppConfig } from './config.js';
import { CORRELATION_HEADER, correlation, correlationIdFrom } from './plugins/correlation.js';
import { errorHandler } from './plugins/error-handler.js';
import { type ReadinessCheck, healthRoutes } from './plugins/health.js';
import { metaRoutes } from './routes/meta.js';

export interface AppDependencies {
  logger: Logger;
  readinessChecks?: ReadinessCheck[];
}

/**
 * Builds the Fastify host. M00 contains platform plumbing only: no tenant resolution,
 * authentication or business routes (those arrive with CMP-002/004/036 in M01+).
 * Component modules register as encapsulated plugins under /v1/<component>.
 */
export async function buildApp(config: AppConfig, deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    genReqId: (req) => correlationIdFrom(req.headers[CORRELATION_HEADER]),
    logController: new LogController({ requestIdLogLabel: 'correlation_id' }),
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: false,
    return503OnClosing: true,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });

  await app.register(errorHandler);
  await app.register(correlation);
  await app.register(helmet, {
    // JSON API: nothing may be framed, scripted or embedded.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
  });
  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxEventLoopUtilization: 0.98,
    exposeStatusRoute: false,
  });

  await app.register(healthRoutes, { checks: deps.readinessChecks ?? [] });
  await app.register(metaRoutes, { config });

  return app;
}
