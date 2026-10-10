import type { ErrorResponse } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { AuthorizationPort } from './authz.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from './context.js';
import { Cmp007Error, mapPgError } from './errors.js';
import type { CataloguePort } from './ports/catalogue-port.js';
import type { ConsentPort } from './ports/consent-port.js';
import type { AiGatewayPort } from './ports/gateway-port.js';
import type { ProfileSignalPort } from './ports/profile-port.js';
import { PgRecommendationRepository } from './repo/pg.js';
import type { RecommendationRepository } from './repo/types.js';
import { registerRoutes } from './routes.js';
import { RecommendationService } from './service/recommendation-service.js';

export interface RecommendationPluginOptions {
  prefix?: string;
  pool?: Pool;
  repository?: RecommendationRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  catalogue: CataloguePort;
  consent: ConsentPort;
  profile: ProfileSignalPort;
  gateway: AiGatewayPort;
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

export function buildRecommendationService(
  opts: RecommendationPluginOptions,
): RecommendationService {
  const repo =
    opts.repository ?? (opts.pool ? new PgRecommendationRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp007Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new RecommendationService({
    repo,
    authorizer: opts.authorizer,
    catalogue: opts.catalogue,
    consent: opts.consent,
    profile: opts.profile,
    gateway: opts.gateway,
    clock: opts.clock ?? (() => new Date()),
  });
}

const pluginImpl: FastifyPluginAsync<RecommendationPluginOptions> = async (app, opts) => {
  const service = buildRecommendationService(opts);

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    request.sfContext = requireTenantContext(await opts.resolveContext(request));
  });

  app.setErrorHandler(async (error: FastifyError | Cmp007Error, request, reply) => {
    if (error instanceof Cmp007Error) {
      return reply
        .code(error.statusCode)
        .send(errorBody(request.id, error.code, error.message, error.details));
    }
    const fe = error as FastifyError;
    if (fe.validation) {
      return reply.code(400).send(errorBody(request.id, 'SF-SYS-003', 'Request validation failed'));
    }
    const mapped = mapPgError(error);
    if (mapped.code !== 'SF-SYS-001') {
      return reply
        .code(mapped.statusCode)
        .send(errorBody(request.id, mapped.code, mapped.message, mapped.details));
    }
    request.log.error({ err: { name: error.name } }, 'cmp-007 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerRoutes(app, service);
};

export const recommendationPlugin: FastifyPluginAsync<RecommendationPluginOptions> = pluginImpl;

export async function registerRecommendation(
  app: FastifyInstance,
  opts: RecommendationPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { ...opts, prefix: opts.prefix ?? '/v1' });
}
