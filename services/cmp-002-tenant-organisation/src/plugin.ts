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
import { Cmp002Error, mapPgError } from './errors.js';
import { registerAdminRoutes } from './routes/admin.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerOfficeRoutes } from './routes/offices.js';
import { registerOrganisationRoutes } from './routes/organisations.js';
import { registerTenantRoutes } from './routes/tenants.js';

export interface TenantOrganisationPluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  audit?: AuditRecorder;
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

const pluginImpl: FastifyPluginAsync<TenantOrganisationPluginOptions> = async (app, opts) => {
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
    const admin = request.url.includes('/admin/');
    request.sfContext = requireContext(raw, !admin);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp002Error, request, reply) => {
    if (error instanceof Cmp002Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-002 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerTenantRoutes(app, deps);
  registerOrganisationRoutes(app, deps);
  registerOfficeRoutes(app, deps);
  registerAdminRoutes(app, deps);
};

export const tenantOrganisationPlugin: FastifyPluginAsync<TenantOrganisationPluginOptions> =
  pluginImpl;

export async function registerTenantOrganisation(
  app: FastifyInstance,
  opts: TenantOrganisationPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort };
export { authorize };
