import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import { apiGatewayPlugin, type GatewayEdgeConfig } from '@serviceform/cmp-036-api-gateway';
import { observabilityPlugin } from '@serviceform/cmp-047-observability';
import type { Logger } from '@serviceform/observability';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import type { AppConfig } from './config.js';
import { registerM02Plugins, type M02PluginMounts } from './composition/m02.js';
import { registerM03Plugins, type M03PluginMounts } from './composition/m03.js';
import { registerWave1Plugins, type Wave1PluginMounts } from './composition/wave1.js';
import { registerWave2Plugins, type Wave2PluginMounts } from './composition/wave2.js';
import { CORRELATION_HEADER, correlation, correlationIdFrom } from './plugins/correlation.js';
import { errorHandler } from './plugins/error-handler.js';
import { type ReadinessCheck, healthRoutes } from './plugins/health.js';
import { metaRoutes } from './routes/meta.js';

export interface AppDependencies {
  logger: Logger;
  readinessChecks?: ReadinessCheck[];
  /** CMP-036 edge overrides (rate limit). */
  gatewayEdge?: GatewayEdgeConfig;
  /**
   * Wave 1 component plugin mounts. Omitted in the default process entry when runtime
   * deps (pool, OPA, secrets) are not configured; unit/host tests supply doubles.
   */
  wave1?: Wave1PluginMounts;
  /**
   * Wave 2 component plugin mounts (CMP-003/030/032). Same optional wiring as wave1.
   */
  wave2?: Wave2PluginMounts;
  /**
   * M02 component plugin mounts (CMP-004/005). Optional; tests supply doubles.
   */
  m02?: M02PluginMounts;
  /**
   * M03 mounts (CMP-001/033/034/051/052/053). Optional; tests supply doubles.
   * CMP-050 Studio is not registered on this Fastify host.
   * CMP-054 has no Fastify plugin on main (UX4G React package only).
   */
  m03?: M03PluginMounts;
}

/**
 * Builds the Fastify host (CMP-036 composition + CMP-047 observability).
 * Component modules register as encapsulated plugins under /v1 (PLAN-REVIEW X-10).
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
  await app.register(observabilityPlugin, { logger: deps.logger });
  await app.register(apiGatewayPlugin, {
    edge: deps.gatewayEdge ?? {
      rateLimit: {
        max: config.SF_GATEWAY_RATE_LIMIT_MAX,
        timeWindowMs: config.SF_GATEWAY_RATE_LIMIT_WINDOW_MS,
      },
    },
  });
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

  if (deps.wave1) {
    const mounted = await registerWave1Plugins(app, deps.wave1);
    app.decorate('wave1Mounted', mounted);
  } else {
    app.decorate('wave1Mounted', [] as string[]);
  }

  if (deps.wave2) {
    const mounted = await registerWave2Plugins(app, deps.wave2);
    app.decorate('wave2Mounted', mounted);
  } else {
    app.decorate('wave2Mounted', [] as string[]);
  }

  if (deps.m02) {
    const mounted = await registerM02Plugins(app, deps.m02);
    app.decorate('m02Mounted', mounted);
  } else {
    app.decorate('m02Mounted', [] as string[]);
  }

  // Decorate only when mounts are supplied so existing M02 host tests still see
  // `m03Mounted` as undefined (Wave A M03 was not registered in that suite).
  if (deps.m03) {
    const mounted = await registerM03Plugins(app, deps.m03);
    app.decorate('m03Mounted', mounted);
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    wave1Mounted: string[];
    wave2Mounted: string[];
    m02Mounted: string[];
    m03Mounted?: string[];
  }
}
