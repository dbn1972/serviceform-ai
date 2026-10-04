import type { ErrorResponse } from '@serviceform/contracts';
import type {
  ObjectStorePort,
  StorageKmsPort,
  StorageSecretsPort,
} from '@serviceform/storage';
import { SimulatedObjectStore } from '@serviceform/storage';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { authorize, denyAllAuthz, type AuthorizationPort } from './authz.js';
import { loadConfig, type StorageServiceConfig } from './config.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { Cmp032Error, mapPgError } from './errors.js';
import { LocalWrapKms } from './ports/kms-port.js';
import { LocalHmacSecrets } from './ports/secrets-port.js';
import type { RouteDeps } from './routes/helpers.js';
import { registerGetAccess } from './routes/get-access.js';
import { registerPostArchive } from './routes/post-archive.js';
import { registerPostObject } from './routes/post-object.js';

export interface StoragePluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer?: AuthorizationPort;
  store?: ObjectStorePort;
  kms?: StorageKmsPort;
  secrets?: StorageSecretsPort;
  config?: StorageServiceConfig;
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

const pluginImpl: FastifyPluginAsync<StoragePluginOptions> = async (app, opts) => {
  const deps: RouteDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer ?? denyAllAuthz(),
    store: opts.store ?? new SimulatedObjectStore(),
    kms: opts.kms ?? new LocalWrapKms(),
    secrets: opts.secrets ?? new LocalHmacSecrets(),
    config: opts.config ?? loadConfig(),
    clock: opts.clock ?? (() => new Date()),
  };

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp032Error, request, reply) => {
    if (error instanceof Cmp032Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-032 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerPostObject(app, deps);
  registerGetAccess(app, deps);
  registerPostArchive(app, deps);
};

export const storagePlugin: FastifyPluginAsync<StoragePluginOptions> = pluginImpl;

export async function registerStorage(
  app: FastifyInstance,
  opts: StoragePluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort };
export { authorize, denyAllAuthz };
