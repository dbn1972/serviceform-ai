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
import { Cmp034Error, mapPgError } from './errors.js';
import { simulatedCodeListImport, type CodeListImportPort } from './ports/code-list-import.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerBindingRoutes } from './routes/bindings.js';
import { registerCodeSetRoutes } from './routes/code-sets.js';
import { registerImportRoutes } from './routes/import.js';
import { registerVersionRoutes } from './routes/versions.js';

export interface MasterDataPluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  audit?: AuditRecorder;
  clock?: () => Date;
  environment?: string;
  importPort?: CodeListImportPort;
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

const pluginImpl: FastifyPluginAsync<MasterDataPluginOptions> = async (app, opts) => {
  const deps: RouteDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer,
    audit: opts.audit ?? outboxAuditRecorder,
    clock: opts.clock ?? (() => new Date()),
    environment: opts.environment ?? 'LOCAL',
    importPort: opts.importPort ?? simulatedCodeListImport(),
  };

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw, true);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp034Error, request, reply) => {
    if (error instanceof Cmp034Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-034 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerCodeSetRoutes(app, deps);
  registerVersionRoutes(app, deps);
  registerImportRoutes(app, deps);
  registerBindingRoutes(app, deps);
};

export const masterDataPlugin: FastifyPluginAsync<MasterDataPluginOptions> = pluginImpl;

export async function registerMasterData(
  app: FastifyInstance,
  opts: MasterDataPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort };
export { authorize };
