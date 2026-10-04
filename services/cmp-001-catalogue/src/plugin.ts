import type { ErrorResponse } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { outboxAuditRecorder, type AuditRecorder } from './audit.js';
import { authorize, type AuthorizationPort } from './authz.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { assertSimulationPolicy, type ConnectorBindingView } from './domain/simulation.js';
import { Cmp001Error, mapPgError } from './errors.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerCanonicalRoutes } from './routes/canonical.js';
import { registerCategoryRoutes } from './routes/categories.js';
import { registerOfferingRoutes } from './routes/offerings.js';

export interface CataloguePluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  audit?: AuditRecorder;
  clock?: () => Date;
  connectorBindings?: ConnectorBindingView[];
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

const pluginImpl: FastifyPluginAsync<CataloguePluginOptions> = async (app, opts) => {
  assertSimulationPolicy(opts.connectorBindings ?? []);
  const deps: RouteDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer,
    audit: opts.audit ?? outboxAuditRecorder,
    clock: opts.clock ?? (() => new Date()),
  };

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    const tenantRequired = request.url.includes('/offerings');
    request.sfContext = requireContext(raw, tenantRequired);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp001Error, request, reply) => {
    if (error instanceof Cmp001Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-001 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerCategoryRoutes(app, deps);
  registerCanonicalRoutes(app, deps);
  registerOfferingRoutes(app, deps);
};

export const cataloguePlugin: FastifyPluginAsync<CataloguePluginOptions> = pluginImpl;

export async function registerCatalogue(
  app: FastifyInstance,
  opts: CataloguePluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort, ConnectorBindingView };
export { authorize, assertSimulationPolicy };
