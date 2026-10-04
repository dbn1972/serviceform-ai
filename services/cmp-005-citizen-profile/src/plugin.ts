import type {
  ConnectorBinding,
  DeploymentEnvironment,
  ErrorResponse,
} from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { outboxAuditRecorder, type AuditRecorder } from './audit.js';
import { authorize, type AuthorizationPort } from './authz.js';
import { SimulatedDigiLockerAdapter } from './connectors/digilocker-simulated.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { assertBindingSafe } from './domain/connector-guard.js';
import { Cmp005Error, mapPgError } from './errors.js';
import type { ConsentAccessPort, DigiLockerPort, SubjectDirectoryPort } from './ports.js';
import { registerProfileRoutes } from './routes/profiles.js';
import type { RouteDeps } from './routes/helpers.js';

export interface CitizenProfilePluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  consentAccess: ConsentAccessPort;
  subjectDirectory: SubjectDirectoryPort;
  audit?: AuditRecorder;
  clock?: () => Date;
  deploymentEnvironment: DeploymentEnvironment;
  digiLockerBinding: ConnectorBinding;
  digiLocker?: DigiLockerPort;
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

const pluginImpl: FastifyPluginAsync<CitizenProfilePluginOptions> = async (app, opts) => {
  if (opts.digiLockerBinding.tenant_id) {
    assertBindingSafe(
      opts.digiLockerBinding,
      opts.deploymentEnvironment,
      opts.digiLockerBinding.tenant_id,
    );
  } else if (opts.deploymentEnvironment === 'PRODUCTION') {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_REFUSED' }] });
  }

  const deps: RouteDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer,
    audit: opts.audit ?? outboxAuditRecorder,
    clock: opts.clock ?? (() => new Date()),
    consentAccess: opts.consentAccess,
    subjectDirectory: opts.subjectDirectory,
    digiLocker: opts.digiLocker ?? new SimulatedDigiLockerAdapter(),
    deploymentEnvironment: opts.deploymentEnvironment,
    digiLockerBinding: opts.digiLockerBinding,
  };

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw, true);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp005Error, request, reply) => {
    if (error instanceof Cmp005Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-005 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  registerProfileRoutes(app, deps);
};

export const citizenProfilePlugin: FastifyPluginAsync<CitizenProfilePluginOptions> = pluginImpl;

export async function registerCitizenProfile(
  app: FastifyInstance,
  opts: CitizenProfilePluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export type { AuthorizationPort };
export { authorize };
