import rateLimit from '@fastify/rate-limit';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyRateLimit from 'fastify-rate-limit';

/** Structural subset of CMP-016 `StudioCaller` / `StudioResponse` / `StudioWorkflowApi`. */
export interface StudioCallerLike {
  tenant_id: string;
  cell_id: string;
  actor: { type: RequestContext['actor']['type']; id: string };
  correlation_id: string;
  trace_id: string;
  roles: readonly string[];
  jurisdiction_ids: readonly string[];
  assurance?: string;
}

export interface StudioResponseLike {
  status: number;
  body: unknown;
  contentType?: string;
}

export interface StudioWorkflowApiLike {
  check(caller: StudioCallerLike, body: unknown): Promise<StudioResponseLike>;
  importBpmn(caller: StudioCallerLike, body: unknown): Promise<StudioResponseLike>;
  createDraft(caller: StudioCallerLike, body: unknown): Promise<StudioResponseLike>;
  exportVersionBpmn(caller: StudioCallerLike, versionId: string): Promise<StudioResponseLike>;
}

export interface PdpLike {
  decide(input: unknown): Promise<{ allow?: unknown }>;
}

/** CMP-016 Studio authorization over OPA with the caller's CMP-004 session roles. */
export function studioWorkflowAuthorizer(pdp: PdpLike, clock: () => Date = () => new Date()) {
  return async (
    caller: StudioCallerLike,
    action: string,
    resource: { type: string; id?: string },
  ): Promise<boolean> => {
    const decision = await pdp.decide({
      subject: {
        user_id: caller.actor.id,
        actor_type: caller.actor.type,
        tenant_id: caller.tenant_id,
        roles: [...caller.roles],
        jurisdiction_ids: [...caller.jurisdiction_ids],
        ...(caller.assurance ? { assurance: caller.assurance } : {}),
      },
      resource: {
        resource_type: resource.type,
        tenant_id: caller.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action,
      environment: { request_time: clock().toISOString(), trace_id: caller.trace_id },
    });
    return decision.allow === true;
  };
}

function errorBody(code: string, message: string, correlationId: string) {
  return { error_code: code, message, correlation_id: correlationId };
}

/**
 * SF-M10-C-2 host mount of the CMP-016 Studio authoring API (component-local OpenAPI
 * `services/cmp-016-workflow-engine/contracts/openapi.json`). Host composition only: tenant and
 * roles come from the server-resolved session, never from the client; CMP-016 decides the rest.
 */
export async function registerStudioWorkflowRoutes(
  app: FastifyInstance,
  opts: {
    api: StudioWorkflowApiLike;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    rateLimitMax?: number;
  },
): Promise<void> {
  await app.register(async (scope) => {
    const limits = { max: opts.rateLimitMax ?? 120, timeWindow: 60_000 };
    await scope.register(rateLimit, limits);
    await scope.register(fastifyRateLimit, limits);

    const run = async (
      request: FastifyRequest,
      reply: FastifyReply,
      fn: (caller: StudioCallerLike) => Promise<StudioResponseLike>,
    ) => {
      const ctx = await opts.resolveContext(request);
      if (!ctx || !ctx.tenant_id) {
        return reply
          .code(401)
          .send(errorBody('SF-AUTH-001', 'Authentication required', request.id));
      }
      const res = await fn({
        tenant_id: ctx.tenant_id,
        cell_id: ctx.cell_id,
        actor: { type: ctx.actor.type, id: ctx.actor.id },
        correlation_id: ctx.correlation_id,
        trace_id: ctx.trace_id,
        roles: ctx.roles,
        jurisdiction_ids: ctx.jurisdiction_ids,
        assurance: ctx.auth_assurance,
      });
      const body =
        res.status >= 400 && typeof res.body === 'object' && res.body !== null
          ? { ...(res.body as Record<string, unknown>), correlation_id: ctx.correlation_id }
          : res.body;
      return reply
        .code(res.status)
        .header('cache-control', 'no-store')
        .type(res.contentType ?? 'application/json')
        .send(body);
    };

    scope.post('/v1/workflow-graphs/check', (request, reply) =>
      run(request, reply, (caller) => opts.api.check(caller, request.body)),
    );
    scope.post('/v1/workflow-graphs/import-bpmn', (request, reply) =>
      run(request, reply, (caller) => opts.api.importBpmn(caller, request.body)),
    );
    scope.post('/v1/workflow-drafts', (request, reply) =>
      run(request, reply, (caller) => opts.api.createDraft(caller, request.body)),
    );
    scope.get<{ Params: { id: string } }>('/v1/workflow-versions/:id/bpmn', (request, reply) =>
      run(request, reply, (caller) => opts.api.exportVersionBpmn(caller, request.params.id)),
    );
  });
}
