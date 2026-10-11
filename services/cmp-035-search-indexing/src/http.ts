import { randomUUID } from 'node:crypto';
import { assertNoTenantIdentifyingHeaders, type HeaderBag } from './context.js';
import { isRequestContext } from './domain/validate.js';
import { Cmp035Error, mapPgError } from './errors.js';
import type { SearchQueryService, ServiceResult } from './service.js';

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

export interface SearchHttpOptions {
  service: SearchQueryService;
  resolveContext: ContextResolver;
}

function param(request: HttpRequestLike, name: string): unknown {
  const p = request.params;
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>)[name] : undefined;
}

export function errorResponse(err: unknown, correlationId: string): HttpResponse {
  const e = err instanceof Cmp035Error ? err : mapPgError(err);
  const body: Record<string, unknown> = {
    error_code: e.code,
    message: e.message,
    correlation_id: correlationId,
  };
  if (e.details && e.details.length > 0 && e.statusCode < 500) body['details'] = e.details;
  return { status: e.statusCode, body, headers: { 'content-type': 'application/json' } };
}

function ok(result: ServiceResult): HttpResponse {
  return {
    status: result.status,
    body: result.body,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  };
}

export function createSearchRoutes(opts: SearchHttpOptions): RouteDefinition[] {
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
      url: '/search/queries',
      handle: wrap((ctx, r) => service.query(ctx, r.body)),
    },
    {
      method: 'GET',
      url: '/search/documents/:documentId',
      handle: wrap((ctx, r) => service.getDocument(ctx, param(r, 'documentId'))),
    },
  ];
}

export function registerSearchRoutes(registrar: RouteRegistrar, opts: SearchHttpOptions): void {
  for (const route of createSearchRoutes(opts)) {
    registrar.route({
      method: route.method,
      url: route.url,
      handler: async (request, reply) => {
        const res = await route.handle(request);
        reply.code(res.status);
        for (const [name, value] of Object.entries(res.headers)) reply.header(name, value);
        return reply.send(res.body);
      },
    });
  }
}
