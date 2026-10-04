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
import { Cmp030Error, mapPgError } from './errors.js';
import { registerAccessCheckRoutes } from './routes/access-check.js';
import { registerConsentRoutes } from './routes/consents.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerNoticeRoutes } from './routes/notices.js';
import { registerPurposeRoutes } from './routes/purposes.js';

export interface ConsentPrivacyPluginOptions {
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

const pluginImpl: FastifyPluginAsync<ConsentPrivacyPluginOptions> = async (app, opts) => {
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
    request.sfContext = requireContext(raw, true);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp030Error, request, reply) => {
    if (error instanceof Cmp030Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-030 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerPurposeRoutes(app, deps);
  registerNoticeRoutes(app, deps);
  registerConsentRoutes(app, deps);
  registerAccessCheckRoutes(app, deps);
};

export const consentPrivacyPlugin: FastifyPluginAsync<ConsentPrivacyPluginOptions> = pluginImpl;

export async function registerConsentPrivacy(
  app: FastifyInstance,
  opts: ConsentPrivacyPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort };
export { authorize };
