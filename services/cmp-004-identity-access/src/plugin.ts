import type { ErrorResponse } from '@serviceform/contracts';
import type { ContextResolver } from '@serviceform/security';
import type { FastifyError, FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IdentityService } from './commands.js';
import { assertNoTenantIdentifyingHeaders, platformContext, requireContext } from './context.js';
import { Cmp004Error, mapPgError } from './errors.js';
import type { IdentityPrincipalVerifier } from './principal-verifier.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IdentityAccessPluginOptions {
  prefix?: string;
  commands: IdentityService;
  verifier: IdentityPrincipalVerifier;
  resolveContext: ContextResolver;
  cellId: string;
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

function ctxOf(req: FastifyRequest, tenantRequired: boolean) {
  return requireContext(req.sfContext, tenantRequired);
}

function correlationId(req: FastifyRequest): string {
  return UUID_RE.test(req.id) ? req.id : randomUUID();
}

const pluginImpl: FastifyPluginAsync<IdentityAccessPluginOptions> = async (app, opts) => {
  const cellId = opts.cellId;

  app.addHook('onRequest', async (request) => {
    assertNoTenantIdentifyingHeaders(request);
  });

  app.addHook('preHandler', async (request) => {
    const publicRoute = Boolean(request.routeOptions.config.sfPublic);
    if (publicRoute) {
      request.sfContext = platformContext(cellId, correlationId(request), '0'.repeat(32));
      return;
    }
    const principal = await opts.verifier.verify(request);
    if (!principal) throw new Cmp004Error('SF-AUTH-001');
    const resolved = await opts.resolveContext.resolve(principal, { cellId });
    request.sfContext = requireContext(
      resolved
        ? { ...resolved, correlation_id: correlationId(request), trace_id: '0'.repeat(32) }
        : null,
      principal.actor_type === 'OFFICER',
    );
  });

  app.setErrorHandler(async (error: FastifyError | Cmp004Error, request, reply) => {
    if (error instanceof Cmp004Error) {
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
    request.log.error({ err: { name: error.name } }, 'cmp-004 failure');
    return reply.code(500).send(errorBody(request.id, 'SF-SYS-001', 'Unexpected server error'));
  });

  app.post(`/identity/citizen/otp/challenges`, {
    config: { sfPublic: true },
    handler: async (req) => {
      const key = req.headers['idempotency-key'];
      return opts.commands.requestCitizenOtp(
        ctxOf(req, false),
        req.body as { channel: string },
        typeof key === 'string' ? key : undefined,
      );
    },
  });

  app.post(`/identity/citizen/otp/verify`, {
    config: { sfPublic: true },
    handler: async (req) =>
      opts.commands.verifyCitizenOtp(
        ctxOf(req, false),
        req.body as { challenge_id: string; code: string },
      ),
  });

  app.post(`/identity/citizen/recovery`, {
    config: { sfPublic: true },
    handler: async (req) =>
      opts.commands.completeRecovery(
        ctxOf(req, false),
        req.body as { challenge_id: string; code: string },
      ),
  });

  app.post(`/identity/citizen/sessions/revoke`, {
    handler: async (req) => opts.commands.revokeCitizenSession(ctxOf(req, false)),
  });

  app.post(`/identity/citizen/links/digilocker`, {
    handler: async (req) =>
      opts.commands.linkDigiLocker(ctxOf(req, false), req.body as { authorization_code: string }),
  });

  app.get(`/identity/me`, {
    handler: async (req) => opts.commands.me(ctxOf(req, false)),
  });

  app.post(`/identity/officer/sessions`, {
    config: { sfPublic: true },
    handler: async (req) => {
      const key = req.headers['idempotency-key'];
      return opts.commands.issueOfficerSession(
        ctxOf(req, false),
        req.body as { assertion: string },
        typeof key === 'string' ? key : undefined,
      );
    },
  });

  app.post(`/identity/officer/sessions/revoke`, {
    handler: async (req) => opts.commands.revokeOfficerSession(ctxOf(req, true)),
  });
};

export const identityAccessPlugin: FastifyPluginAsync<IdentityAccessPluginOptions> = pluginImpl;

export async function registerIdentityAccess(
  app: FastifyInstance,
  opts: IdentityAccessPluginOptions,
): Promise<void> {
  await app.register(pluginImpl, { prefix: opts.prefix ?? '/v1', ...opts });
}
