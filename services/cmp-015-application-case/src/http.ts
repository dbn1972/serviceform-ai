import { randomUUID } from 'node:crypto';
import { assertNoTenantIdentifyingHeaders, type HeaderBag } from './context.js';
import { isRequestContext } from './domain/validate.js';
import { Cmp015Error, mapPgError } from './errors.js';
import type { ApplicationCaseService, ServiceResult } from './service.js';

/**
 * Framework-neutral HTTP surface (contracts/openapi.json). The API host mounts it under /v1 in
 * SF-M05-009; RouteRegistrar is the structural subset of Fastify's `app.route` it needs, so this
 * package carries no web-framework dependency.
 */
export interface HttpRequestLike {
  headers: HeaderBag;
  params?: unknown;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export type ContextResolver = (request: HttpRequestLike) => Promise<unknown>;

export interface RouteDefinition {
  method: 'GET' | 'POST';
  url: string;
  handle(request: HttpRequestLike): Promise<HttpResponse>;
}

export interface ReplyLike {
  code(statusCode: number): ReplyLike;
  header(name: string, value: string): ReplyLike;
  send(payload?: unknown): unknown;
}

export interface RouteRegistrar {
  route(options: {
    method: string;
    url: string;
    handler: (request: HttpRequestLike, reply: ReplyLike) => Promise<unknown>;
  }): unknown;
}

export interface ApplicationCaseHttpOptions {
  service: ApplicationCaseService;
  resolveContext: ContextResolver;
}

function param(request: HttpRequestLike, name: string): unknown {
  const p = request.params;
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>)[name] : undefined;
}

function header(request: HttpRequestLike, name: string): unknown {
  const raw = request.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function errorResponse(err: unknown, correlationId: string): HttpResponse {
  const e = err instanceof Cmp015Error ? err : mapPgError(err);
  const body: Record<string, unknown> = {
    error_code: e.code,
    message: e.message,
    correlation_id: correlationId,
  };
  if (e.details && e.details.length > 0 && e.statusCode < 500) body['details'] = e.details;
  return { status: e.statusCode, body, headers: { 'content-type': 'application/json' } };
}

function ok(result: ServiceResult): HttpResponse {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (result.replayed) headers['idempotent-replayed'] = 'true';
  return { status: result.status, body: result.body, headers };
}

export function createApplicationCaseRoutes(opts: ApplicationCaseHttpOptions): RouteDefinition[] {
  const { service } = opts;
  const wrap =
    (fn: (ctx: unknown, request: HttpRequestLike) => Promise<ServiceResult>) =>
    async (request: HttpRequestLike): Promise<HttpResponse> => {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(request.headers);
        const ctx = await opts.resolveContext(request);
        if (isRequestContext(ctx)) correlationId = ctx.correlation_id;
        return ok(await fn(ctx, request));
      } catch (err) {
        return errorResponse(err, correlationId);
      }
    };

  return [
    {
      method: 'POST',
      url: '/applications',
      handle: wrap((ctx, r) => service.createDraft(ctx, r.body, header(r, 'idempotency-key'))),
    },
    {
      method: 'GET',
      url: '/applications/:applicationId',
      handle: wrap((ctx, r) => service.getApplication(ctx, param(r, 'applicationId'))),
    },
    {
      method: 'GET',
      url: '/applications/:applicationId/transitions',
      handle: wrap((ctx, r) => service.listTransitions(ctx, param(r, 'applicationId'))),
    },
    {
      method: 'POST',
      url: '/applications/:applicationId/commands',
      handle: wrap((ctx, r) =>
        service.executeCommand(
          ctx,
          param(r, 'applicationId'),
          r.body,
          header(r, 'idempotency-key'),
        ),
      ),
    },
    {
      method: 'POST',
      url: '/applications/:applicationId/requests',
      handle: wrap((ctx, r) =>
        service.registerRequest(
          ctx,
          param(r, 'applicationId'),
          r.body,
          header(r, 'idempotency-key'),
        ),
      ),
    },
    {
      method: 'POST',
      url: '/applications/:applicationId/requests/:requestId/status',
      handle: wrap((ctx, r) =>
        service.updateRequestStatus(
          ctx,
          param(r, 'applicationId'),
          param(r, 'requestId'),
          r.body,
          header(r, 'idempotency-key'),
        ),
      ),
    },
  ];
}

export function registerApplicationCaseRoutes(
  app: RouteRegistrar,
  opts: ApplicationCaseHttpOptions,
): string[] {
  const routes = createApplicationCaseRoutes(opts);
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.url,
      handler: async (request, reply) => {
        const res = await route.handle(request);
        let r = reply.code(res.status);
        for (const [name, value] of Object.entries(res.headers)) r = r.header(name, value);
        return r.send(res.body);
      },
    });
  }
  return routes.map((r) => `${r.method} ${r.url}`);
}
