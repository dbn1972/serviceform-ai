import rateLimit from '@fastify/rate-limit';
import { errorEntry } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import type { Pool } from 'pg';
import { authorize, denyAllAuthz, type AuthorizationPort } from './authz.js';
import { loadConfig, type AiGatewayConfig } from './config.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { Cmp039Error, mapPgError } from './errors.js';
import { aiGatewayRateLimitOptions } from './http/rate-limit.js';
import {
  denyAllPurposeConsent,
  denyAllSourceAcl,
  type PurposeConsentPort,
  type SourceAclPort,
} from './ports/policy-ports.js';
import { buildProviderRegistry, type ProviderRegistry } from './ports/provider.js';
import { registerGatewayRoutes } from './routes/gateway-routes.js';
import type { GatewayDeps } from './service/gateway.js';
import { errorBody } from './service/outcomes.js';

export interface AiGatewayPluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer?: AuthorizationPort;
  providers?: ProviderRegistry;
  consent?: PurposeConsentPort;
  sources?: SourceAclPort;
  config?: AiGatewayConfig;
  clock?: () => Date;
}

const pluginImpl: FastifyPluginAsync<AiGatewayPluginOptions> = async (app, opts) => {
  const config = opts.config ?? loadConfig();
  const deps: GatewayDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer ?? denyAllAuthz(),
    providers: opts.providers ?? buildProviderRegistry(config),
    consent: opts.consent ?? denyAllPurposeConsent(),
    sources: opts.sources ?? denyAllSourceAcl(),
    config,
    clock: opts.clock ?? (() => new Date()),
  };

  const rateLimitOpts = aiGatewayRateLimitOptions(config.rateLimitMax, config.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp039Error, request, reply) => {
    if (error instanceof Cmp039Error) {
      return reply
        .code(error.statusCode)
        .send(errorBody(request.id, error.code, error.message, error.details));
    }
    const fe = error as FastifyError;
    if (fe.validation) {
      return reply.code(400).send(errorBody(request.id, 'SF-SYS-003', 'Request validation failed'));
    }
    if (fe.statusCode === 429) {
      return reply
        .code(429)
        .send(errorBody(request.id, 'SF-RATE-001', errorEntry('SF-RATE-001').message));
    }
    const mapped = mapPgError(error);
    if (mapped.code !== 'SF-SYS-001') {
      return reply
        .code(mapped.statusCode)
        .send(errorBody(request.id, mapped.code, mapped.message, mapped.details));
    }
    request.log.error({ err: { name: error.name } }, 'cmp-039 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  await registerGatewayRoutes(app, deps);
};

export const aiGatewayPlugin: FastifyPluginAsync<AiGatewayPluginOptions> = pluginImpl;

export async function registerAiGateway(
  app: FastifyInstance,
  opts: AiGatewayPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort, PurposeConsentPort, SourceAclPort, ProviderRegistry };
export { authorize, denyAllAuthz };
