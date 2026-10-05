import { errorEntry, type ErrorResponse } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { authorize, denyAllAuthz, type AuthorizationPort } from './authz.js';
import { loadConfig, type FormsConfig } from './config.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { Cmp009Error, mapPgError } from './errors.js';
import {
  DenyFormDefinitionPort,
  wrapFormDefinitionPort,
  type FormDefinitionPort,
} from './ports/form-definition.js';
import {
  DenyLocalizationPort,
  wrapLocalizationPort,
  type LocalizationPort,
} from './ports/localization.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerFormRoutes } from './routes/forms.js';

export interface FormsPluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer?: AuthorizationPort;
  forms?: FormDefinitionPort;
  localization?: LocalizationPort;
  config?: FormsConfig;
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

const pluginImpl: FastifyPluginAsync<FormsPluginOptions> = async (app, opts) => {
  const config = opts.config ?? loadConfig();
  const deps: RouteDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer ?? denyAllAuthz(),
    forms: wrapFormDefinitionPort(opts.forms ?? new DenyFormDefinitionPort()),
    localization: wrapLocalizationPort(opts.localization ?? new DenyLocalizationPort()),
    config,
    clock: opts.clock ?? (() => new Date()),
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  };

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp009Error, request, reply) => {
    if (error instanceof Cmp009Error) {
      return reply
        .code(error.statusCode)
        .send(errorBody(request.id, error.code, error.message, error.details));
    }
    const fe = error as FastifyError;
    if (fe.validation) {
      return reply.code(400).send(errorBody(request.id, 'SF-SYS-003', 'Request validation failed'));
    }
    const status = fe.statusCode;
    if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
      return reply.code(400).send(errorBody(request.id, 'SF-SYS-003', 'Request validation failed'));
    }
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
    request.log.error({ err: { name: error.name } }, 'cmp-009 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  await registerFormRoutes(app, deps);
};

export const formsPlugin: FastifyPluginAsync<FormsPluginOptions> = pluginImpl;

export async function registerForms(app: FastifyInstance, opts: FormsPluginOptions): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort, FormDefinitionPort, LocalizationPort };
export { authorize, denyAllAuthz };
