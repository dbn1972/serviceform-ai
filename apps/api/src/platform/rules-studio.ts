import rateLimit from '@fastify/rate-limit';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';
import { studioWorkflowAuthorizer, type PdpLike } from './workflow-studio.js';

/** Structural subset of CMP-008 `StudioRulesApi`. */
export interface StudioRulesApiLike {
  test(
    caller: {
      tenant_id: string;
      actor: { type: string; id: string };
      roles: readonly string[];
      correlation_id: string;
      trace_id: string;
      jurisdiction_ids?: readonly string[];
      assurance?: string;
    },
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
}

export interface Cmp008StudioModule {
  createStudioRulesApi(deps: {
    authorize: (
      caller: Parameters<StudioRulesApiLike['test']>[0],
      action: 'RULE_PACK_TEST',
      resource: { type: 'RulePack' },
    ) => Promise<boolean>;
    engine: unknown;
    timeoutMs?: number;
  }): StudioRulesApiLike;
  ZenRuleEngine: new () => unknown;
}

/** CMP-008 Studio test bench on the ZEN engine, authorised by OPA with the session roles. */
export function composeStudioRules(cmp008: Cmp008StudioModule, pdp: PdpLike): StudioRulesApiLike {
  const authorize = studioWorkflowAuthorizer(pdp);
  return cmp008.createStudioRulesApi({
    authorize: (caller, action, resource) =>
      authorize(
        {
          tenant_id: caller.tenant_id,
          cell_id: 'cell-local',
          actor: caller.actor as { type: RequestContext['actor']['type']; id: string },
          correlation_id: caller.correlation_id,
          trace_id: caller.trace_id,
          roles: caller.roles,
          jurisdiction_ids: caller.jurisdiction_ids ?? [],
          ...(caller.assurance ? { assurance: caller.assurance } : {}),
        },
        action,
        resource,
      ),
    engine: new cmp008.ZenRuleEngine(),
    timeoutMs: 2000,
  });
}

/**
 * SF-M10-C-3 host mount of `POST /v1/rule-packs/test` (CMP-008 component-local OpenAPI). Tenant
 * and roles come from the server-resolved session; nothing is persisted.
 */
export async function registerStudioRulesRoutes(
  app: FastifyInstance,
  opts: {
    api: StudioRulesApiLike;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    rateLimitMax?: number;
  },
): Promise<void> {
  await app.register(async (scope) => {
    const limits = { max: opts.rateLimitMax ?? 120, timeWindow: 60_000 };
    await scope.register(rateLimit, limits);
    await scope.register(fastifyRateLimit, limits);
    scope.post('/v1/rule-packs/test', async (request, reply) => {
      const ctx = await opts.resolveContext(request);
      if (!ctx || !ctx.tenant_id) {
        return reply.code(401).send({
          error_code: 'SF-AUTH-001',
          message: 'Authentication required',
          correlation_id: request.id,
        });
      }
      const res = await opts.api.test(
        {
          tenant_id: ctx.tenant_id,
          actor: { type: ctx.actor.type, id: ctx.actor.id },
          roles: ctx.roles,
          correlation_id: ctx.correlation_id,
          trace_id: ctx.trace_id,
          jurisdiction_ids: ctx.jurisdiction_ids,
          assurance: ctx.auth_assurance,
        },
        request.body,
      );
      const body =
        res.status >= 400 && typeof res.body === 'object' && res.body !== null
          ? { ...(res.body as Record<string, unknown>), correlation_id: ctx.correlation_id }
          : res.body;
      return reply.code(res.status).header('cache-control', 'no-store').send(body);
    });
  });
}
