import rateLimit from '@fastify/rate-limit';
import { errorEntry, type ConnectorBinding, type ErrorResponse } from '@serviceform/contracts';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { authorize, denyAllAuthz, type AuthorizationPort } from './authz.js';
import { loadConfig, type EvidenceConfig } from './config.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireContext,
  type ContextResolver,
} from './context.js';
import { SimulatedDigiLockerEvidenceAdapter } from './connectors/digilocker-simulated.js';
import { assertBindingSafe } from './domain/connector-guard.js';
import { Cmp011Error, mapPgError } from './errors.js';
import { evidenceRateLimitOptions } from './http/rate-limit.js';
import { DenyApprovalPort, wrapApprovalPort, type ApprovalPort } from './ports/approval.js';
import type { BindingPinPort } from './ports/binding.js';
import type { ConsentAccessPort } from './ports/consent.js';
import type { DigiLockerEvidencePort } from './ports/digilocker.js';
import type { DocumentClassificationPort } from './ports/ocr.js';
import { EmptyUploadedEvidencePort, type UploadedEvidencePort } from './ports/uploads.js';
import { registerEvidenceRoutes } from './routes/policies.js';
import type { EvidenceDeps } from './service/deps.js';

export interface EvidencePluginOptions {
  prefix?: string;
  pool: Pool;
  resolveContext: ContextResolver;
  bindingPins: BindingPinPort;
  authorizer?: AuthorizationPort;
  approval?: ApprovalPort;
  uploads?: UploadedEvidencePort;
  classification?: DocumentClassificationPort;
  consent?: ConsentAccessPort;
  digiLocker?: DigiLockerEvidencePort;
  digiLockerBinding?: ConnectorBinding;
  config?: EvidenceConfig;
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

const pluginImpl: FastifyPluginAsync<EvidencePluginOptions> = async (app, opts) => {
  const config = opts.config ?? loadConfig();
  const clock = opts.clock ?? (() => new Date());

  let digiLocker = opts.digiLocker;
  if (opts.digiLockerBinding) {
    if (config.digiLockerMode !== 'SIMULATED') {
      throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'DIGILOCKER_MODE_OFF' }] });
    }
    if (opts.digiLockerBinding.tenant_id) {
      assertBindingSafe(
        opts.digiLockerBinding,
        config.environment,
        opts.digiLockerBinding.tenant_id,
      );
    } else if (config.environment === 'PRODUCTION') {
      throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_REFUSED' }] });
    }
    digiLocker ??= new SimulatedDigiLockerEvidenceAdapter({
      environment: config.environment,
      connectorBindingId: opts.digiLockerBinding.connector_binding_id,
      clock,
    });
  }

  const deps: EvidenceDeps = {
    pool: opts.pool,
    authorizer: opts.authorizer ?? denyAllAuthz(),
    approval: wrapApprovalPort(opts.approval ?? new DenyApprovalPort()),
    config,
    clock,
    bindingPins: opts.bindingPins,
    uploads: opts.uploads ?? new EmptyUploadedEvidencePort(),
    ...(opts.classification ? { classification: opts.classification } : {}),
    ...(opts.consent ? { consent: opts.consent } : {}),
    ...(digiLocker ? { digiLocker } : {}),
    ...(opts.digiLockerBinding ? { digiLockerBinding: opts.digiLockerBinding } : {}),
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  };

  await app.register(
    rateLimit,
    evidenceRateLimitOptions(deps.rateLimitMax, deps.rateLimitWindowMs),
  );

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const raw = await opts.resolveContext(request);
    request.sfContext = requireContext(raw);
  });

  app.setErrorHandler(async (error: FastifyError | Cmp011Error, request, reply) => {
    if (error instanceof Cmp011Error) {
      return reply
        .code(error.statusCode)
        .send(errorBody(request.id, error.code, error.message, error.details));
    }
    const fe = error as FastifyError;
    if (fe.validation) {
      return reply.code(400).send(errorBody(request.id, 'SF-SYS-003', 'Request validation failed'));
    }
    if (fe.statusCode === 429) {
      return reply
        .code(429)
        .send(errorBody(request.id, 'SF-RATE-001', errorEntry('SF-RATE-001').message));
    }
    if (typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply.code(400).send(errorBody(request.id, 'SF-SYS-003', 'Request validation failed'));
    }
    const mapped = mapPgError(error);
    if (mapped.code !== 'SF-SYS-001') {
      return reply
        .code(mapped.statusCode)
        .send(errorBody(request.id, mapped.code, mapped.message, mapped.details));
    }
    request.log.error({ err: { name: error.name } }, 'cmp-011 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  await registerEvidenceRoutes(app, deps);
};

export const evidencePlugin: FastifyPluginAsync<EvidencePluginOptions> = pluginImpl;

export async function registerEvidence(
  app: FastifyInstance,
  opts: EvidencePluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}

export { authorize, denyAllAuthz };
export type { AuthorizationPort, ApprovalPort };
