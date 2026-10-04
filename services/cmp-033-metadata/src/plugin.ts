import rateLimit from '@fastify/rate-limit';
import { errorEntry, type ErrorResponse } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import type { Pool } from 'pg';
import { authorize, denyAllAuthz, type AuthorizationPort } from './authz.js';
import { loadConfig, type MetadataServiceConfig } from './config.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { Cmp033Error, mapPgError } from './errors.js';
import { metadataRateLimitOptions } from './http/rate-limit.js';
import {
  SimulatedSchemaRegistry,
  wrapSchemaRegistry,
  type SchemaRegistryPort,
} from './ports/schema-registry.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerLifecycleRoutes } from './routes/lifecycle.js';

export interface MetadataPluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer?: AuthorizationPort;
  registry?: SchemaRegistryPort;
  config?: MetadataServiceConfig;
  clock?: () => Date;
}

function errorBody(
  correlationId: string,
  code: string,
  message: string,
  details?: ErrorResponse['details'],
): ErrorResponse {
  const out: ErrorResponse = { error_code: code, message, correlation_id: correlationId };
  if (details && details.length > 0) out.details = details;
  return out;
}

const pluginImpl: FastifyPluginAsync<MetadataPluginOptions> = async (app, opts) => {
  const config = opts.config ?? loadConfig();
  const deps: RouteDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer ?? denyAllAuthz(),
    registry: wrapSchemaRegistry(opts.registry ?? new SimulatedSchemaRegistry(config)),
    config,
    clock: opts.clock ?? (() => new Date()),
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  };

  const rateLimitOpts = metadataRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs);
  await app.register(rateLimit, rateLimitOpts);
  await app.register(fastifyRateLimit, rateLimitOpts);

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp033Error, request, reply) => {
    if (error instanceof Cmp033Error) {
      return reply
        .code(error.statusCode)
        .send(errorBody(request.id, error.code, error.message, error.details));
    }
    const fe = error as FastifyError;
    if (fe.validation) {
      return reply.code(400).send(errorBody(request.id, 'SF-SYS-003', 'Request validation failed'));
    }
    const status = fe.statusCode;
    if (status === 429) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-033 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  await registerDocumentRoutes(app, deps);
  await registerLifecycleRoutes(app, deps);
};

export const metadataPlugin: FastifyPluginAsync<MetadataPluginOptions> = pluginImpl;

export async function registerMetadata(
  app: FastifyInstance,
  opts: MetadataPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort, SchemaRegistryPort };
export { authorize, denyAllAuthz };
