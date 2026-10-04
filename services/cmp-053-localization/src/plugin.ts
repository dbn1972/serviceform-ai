import type {
  ConnectorBinding,
  DeploymentEnvironment,
  ErrorResponse,
} from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { outboxAuditRecorder, type AuditRecorder } from './audit.js';
import { authorize, type AuthorizationPort } from './authz.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { Cmp053Error, mapPgError } from './errors.js';
import {
  assertAssistBindingSafe,
  DisabledAssistPort,
  SimulatedAssistAdapter,
  type TranslationAssistPort,
} from './ports/assist.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerCatalogRoutes } from './routes/catalogs.js';
import { registerLocaleRoutes } from './routes/locales.js';
import { registerResolveRoutes } from './routes/resolve.js';

export interface LocalizationPluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  audit?: AuditRecorder;
  clock?: () => Date;
  deploymentEnvironment?: DeploymentEnvironment;
  assistBinding?: ConnectorBinding | null;
  assist?: TranslationAssistPort;
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

function defaultAssist(
  env: DeploymentEnvironment,
  binding: ConnectorBinding | null | undefined,
  override?: TranslationAssistPort,
): TranslationAssistPort {
  assertAssistBindingSafe(env, binding ?? null);
  if (override) return override;
  if (binding?.mode === 'SIMULATED') return new SimulatedAssistAdapter(binding);
  return new DisabledAssistPort();
}

const pluginImpl: FastifyPluginAsync<LocalizationPluginOptions> = async (app, opts) => {
  const env = opts.deploymentEnvironment ?? 'LOCAL';
  const deps: RouteDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer,
    audit: opts.audit ?? outboxAuditRecorder,
    clock: opts.clock ?? (() => new Date()),
    assist: defaultAssist(env, opts.assistBinding, opts.assist),
  };

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw, true);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp053Error, request, reply) => {
    if (error instanceof Cmp053Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-053 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerLocaleRoutes(app, deps);
  registerCatalogRoutes(app, deps);
  registerResolveRoutes(app, deps);
};

export const localizationPlugin: FastifyPluginAsync<LocalizationPluginOptions> = pluginImpl;

export async function registerLocalization(
  app: FastifyInstance,
  opts: LocalizationPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort, TranslationAssistPort };
export { authorize, assertAssistBindingSafe, SimulatedAssistAdapter, DisabledAssistPort };
