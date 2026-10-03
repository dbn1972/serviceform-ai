import type {
  AuthzDecisionInput,
  AuthzDecisionOutput,
  RequestContext,
} from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import type { Logger } from '@serviceform/observability';
import { trace } from '@opentelemetry/api';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { AuditSink } from './audit-sink.js';
import { SecurityError } from './errors.js';
import { authorizeAction, isPdpFailure, type AuthzResource } from './pep/authorize.js';
import { assertOpaUrl, type PdpClient } from './pep/pdp-client.js';
import {
  AuthzRateLimiter,
  defaultAuthzRateLimit,
  rateLimitAuthorization,
  type AuthzRateLimitConfig,
} from './pep/rate-limit.js';
import { deepFreeze, type ContextResolver, type PrincipalVerifier } from './principal.js';

const FORGED = [
  'x-tenant-id',
  'x-sf-tenant',
  'x-sf-roles',
  'x-sf-assurance',
  'x-delegation-id',
  'x-actor-type',
  'x-request-time',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SfAuthzConfig {
  action: string;
  resource: (req: FastifyRequest) => AuthzResource;
}

export interface SfSecurityOptions {
  verifier: PrincipalVerifier;
  resolver: ContextResolver;
  pdp: PdpClient;
  cellId: string;
  logger?: Logger;
  audit?: AuditSink;
  opaUrl?: string;
  /** In-process PEP bound. Edge/gateway quotas remain a platform (CMP-036) concern. */
  authzRateLimit?: AuthzRateLimitConfig;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    sfAuthz?: SfAuthzConfig;
    sfPublic?: boolean;
  }
  interface FastifyRequest {
    sfContext?: RequestContext;
    authorize: (
      action: string,
      resource: AuthzResource,
      workflow_context?: AuthzDecisionInput['workflow_context'],
    ) => Promise<AuthzDecisionOutput>;
  }
}

function headerForbidden(req: FastifyRequest): boolean {
  for (const name of FORGED) {
    if (req.headers[name] !== undefined) return true;
  }
  return false;
}

function traceIdFromSpan(): string {
  const span = trace.getActiveSpan();
  const id = span?.spanContext().traceId;
  if (id && /^[0-9a-f]{32}$/.test(id)) return id;
  return randomUUID().replaceAll('-', '');
}

function correlationId(req: FastifyRequest): string {
  return UUID_RE.test(req.id) ? req.id : randomUUID();
}

function routeDeclared(route: RouteOptions): boolean {
  const cfg = route.config;
  return Boolean(cfg?.sfAuthz || cfg?.sfPublic);
}

export const sfSecurity = fp(
  async (app: FastifyInstance, opts: SfSecurityOptions) => {
    if (!opts.verifier || !opts.resolver || !opts.pdp) {
      throw new Error('sfSecurity requires verifier, resolver and pdp');
    }
    if (opts.opaUrl !== undefined) assertOpaUrl(opts.opaUrl);
    const rl = opts.authzRateLimit ?? defaultAuthzRateLimit;
    const limiter = new AuthzRateLimiter(rl);

    await app.register(fastifyRateLimit, {
      global: true,
      hook: 'onRequest',
      max: rl.max,
      timeWindow: rl.windowMs,
      addHeaders: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
        'retry-after': false,
      },
      addHeadersOnExceeding: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
      },
      allowList: (req) => Boolean(req.routeOptions.config.sfPublic),
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: 'Too Many Requests',
        error_code: 'SF-RATE-001',
        message: 'authorization rate limit exceeded',
      }),
    });

    app.decorateRequest('authorize', async function denyUntilReady() {
      throw new SecurityError('SF-TEN-001', { statusCode: 401 });
    });

    app.addHook('onRoute', (route) => {
      if (route.config?.sfAuthz && route.config.sfPublic) {
        throw new Error(`route ${route.url} cannot be both sfPublic and sfAuthz`);
      }
      if (!routeDeclared(route)) {
        throw new Error(`route ${route.method} ${route.url} must declare sfAuthz or sfPublic`);
      }
    });

    async function rateLimit(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
      if (req.routeOptions.config.sfPublic) return;
      rateLimitAuthorization(req, limiter);
    }

    async function resolvePrincipal(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
      req.authorize = async (action, resource, workflow) => {
        const ctx = req.sfContext;
        if (!ctx) throw new SecurityError('SF-TEN-001', { statusCode: 401 });
        const args: Parameters<typeof authorizeAction>[0] = {
          ctx,
          action,
          resource,
          pdp: opts.pdp,
        };
        if (opts.logger) args.logger = opts.logger;
        if (workflow) args.workflow_context = workflow;
        return authorizeAction(args);
      };

      if (headerForbidden(req)) {
        throw new SecurityError('SF-TEN-002', { statusCode: 403 });
      }
      if (req.routeOptions.config.sfPublic) return;

      let principal;
      try {
        principal = await opts.verifier.verify(req);
      } catch (err) {
        throw new SecurityError('SF-AUTH-001', { statusCode: 401, cause: err });
      }
      if (!principal) throw new SecurityError('SF-AUTH-001', { statusCode: 401 });

      let resolved;
      try {
        resolved = await opts.resolver.resolve(principal, { cellId: opts.cellId });
      } catch (err) {
        throw new SecurityError('SF-TEN-001', { statusCode: 401, cause: err });
      }
      if (!resolved) throw new SecurityError('SF-TEN-001', { statusCode: 401 });

      const ctx: RequestContext = {
        ...resolved,
        correlation_id: correlationId(req),
        trace_id: traceIdFromSpan(),
      };
      const check = validate('request-context', ctx);
      if (!check.valid) throw new SecurityError('SF-TEN-001', { statusCode: 401 });
      req.sfContext = deepFreeze(ctx);
    }

    async function enforceRouteAuthz(req: FastifyRequest): Promise<void> {
      const authz = req.routeOptions.config.sfAuthz;
      if (!authz) return;
      const decision = await req.authorize(authz.action, authz.resource(req));
      if (decision.allow) return;
      if (decision.reason_code === 'TENANT_MISMATCH') {
        throw new SecurityError('SF-TEN-002', { statusCode: 403 });
      }
      if (isPdpFailure(decision.reason_code)) {
        throw new SecurityError('SF-SYS-004', {
          statusCode: 503,
          details: [{ code: decision.reason_code }],
        });
      }
      throw new SecurityError('SF-AUTH-002', { statusCode: 403 });
    }

    app.addHook('onRequest', rateLimit);
    app.addHook('onRequest', resolvePrincipal);
    app.addHook('preHandler', rateLimit);
    app.addHook('preHandler', enforceRouteAuthz);
  },
  { name: 'sf-security', fastify: '5.x' },
);
