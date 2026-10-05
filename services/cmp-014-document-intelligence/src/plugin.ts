import type { DeploymentEnvironment, ErrorResponse } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { AuthorizationPort } from './authz.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from './context.js';
import { adapterBindings, assertSimulationPolicy } from './domain/simulation.js';
import { Cmp014Error, mapPgError } from './errors.js';
import type { AiGatewayPort } from './ports/gateway-port.js';
import type { OcrPort } from './ports/ocr-port.js';
import type { SourceAclPort, SourceDocumentPort } from './ports/source-port.js';
import { PgDocIntelRepository } from './repo/pg.js';
import type { DocIntelRepository } from './repo/types.js';
import { registerRoutes } from './routes.js';
import { IntelligenceService } from './service/intelligence-service.js';

export interface DocumentIntelligencePluginOptions {
  prefix?: string;
  environment: DeploymentEnvironment;
  pool?: Pool;
  repository?: DocIntelRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  sources: SourceDocumentPort;
  sourceAcl: SourceAclPort;
  ocr: OcrPort;
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

export function buildIntelligenceService(
  opts: DocumentIntelligencePluginOptions,
): IntelligenceService {
  assertSimulationPolicy(adapterBindings(opts.environment, [opts.ocr]));
  if (opts.ocr.mode === 'SIMULATED' && !opts.ocr.simulation) {
    throw new Cmp014Error('SF-INT-001', { details: [{ code: 'SIMULATION_MARKER_REQUIRED' }] });
  }
  const repo = opts.repository ?? (opts.pool ? new PgDocIntelRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp014Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new IntelligenceService({
    repo,
    authorizer: opts.authorizer,
    sources: opts.sources,
    sourceAcl: opts.sourceAcl,
    ocr: opts.ocr,
    gateway: opts.gateway,
    clock: opts.clock ?? (() => new Date()),
  });
}

const pluginImpl: FastifyPluginAsync<DocumentIntelligencePluginOptions> = async (app, opts) => {
  const service = buildIntelligenceService(opts);

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    request.sfContext = requireTenantContext(await opts.resolveContext(request));
  });

  app.setErrorHandler(async (error: FastifyError | Cmp014Error, request, reply) => {
    if (error instanceof Cmp014Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-014 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerRoutes(app, service);
};

export const documentIntelligencePlugin: FastifyPluginAsync<DocumentIntelligencePluginOptions> =
  pluginImpl;

export async function registerDocumentIntelligence(
  app: FastifyInstance,
  opts: DocumentIntelligencePluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { ...opts, prefix: opts.prefix ?? '/v1' });
}
