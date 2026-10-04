import type { DeploymentEnvironment, ErrorResponse } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { AuthorizationPort } from './authz.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from './context.js';
import {
  adapterBindings,
  assertSimulationPolicy,
  type ConnectorBindingView,
} from './domain/simulation.js';
import { Cmp013Error, detail, mapPgError } from './errors.js';
import type { MalwareScanPort } from './ports/scan-port.js';
import type { DocumentStoragePort } from './ports/storage-port.js';
import { PgUploadRepository } from './repo/pg.js';
import type { UploadRepository } from './repo/types.js';
import { registerRoutes } from './routes.js';
import { UploadService } from './service/upload-service.js';

export interface DocumentUploadPluginOptions {
  prefix?: string;
  environment: DeploymentEnvironment;
  /** Runtime pool whose login is a member of sf_app + sf_cmp013_rw only. */
  pool?: Pool;
  repository?: UploadRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  storage: DocumentStoragePort;
  scanner: MalwareScanPort;
  workerActorId: string;
  clock?: () => Date;
  downloadTtlSeconds?: number;
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

/**
 * INT-013 fail-closed wiring: storage and malware scanning are critical connectors, so a
 * SIMULATED adapter in PRODUCTION (or outside simulation environments) refuses to register.
 */
export function buildUploadService(opts: DocumentUploadPluginOptions): UploadService {
  assertSimulationPolicy([
    ...adapterBindings(opts.environment, [opts.storage, opts.scanner]),
    ...(opts.connectorBindings ?? []),
  ]);
  for (const adapter of [opts.storage, opts.scanner]) {
    if (adapter.mode === 'SIMULATED' && !adapter.simulation) {
      throw new Cmp013Error('SF-INT-001', detail('SIMULATION_MARKER_REQUIRED'));
    }
  }
  const repo = opts.repository ?? (opts.pool ? new PgUploadRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp013Error('SF-SYS-001', detail('REPOSITORY_REQUIRED'));
  const ttl = opts.downloadTtlSeconds ?? 300;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) {
    throw new Cmp013Error('SF-SYS-003', detail('DOWNLOAD_TTL'));
  }
  return new UploadService({
    repo,
    storage: opts.storage,
    scanner: opts.scanner,
    authorizer: opts.authorizer,
    clock: opts.clock ?? (() => new Date()),
    downloadTtlSeconds: ttl,
    workerActorId: opts.workerActorId,
  });
}

const pluginImpl: FastifyPluginAsync<DocumentUploadPluginOptions> = async (app, opts) => {
  const service = buildUploadService(opts);

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    request.sfContext = requireTenantContext(await opts.resolveContext(request));
  });

  app.setErrorHandler(async (error: FastifyError | Cmp013Error, request, reply) => {
    if (error instanceof Cmp013Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-013 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerRoutes(app, service);
};

export const documentUploadPlugin: FastifyPluginAsync<DocumentUploadPluginOptions> = pluginImpl;

export async function registerDocumentUpload(
  app: FastifyInstance,
  opts: DocumentUploadPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { ...opts, prefix: opts.prefix ?? '/v1' });
}
