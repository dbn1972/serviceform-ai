import { randomUUID } from 'node:crypto';
import { assertNoTenantIdentifyingHeaders, type HeaderBag } from './context.js';
import { isRequestContext } from './domain/validate.js';
import { Cmp027Error, mapPgError } from './errors.js';
import type { GrievanceFeedbackService, ServiceResult } from './service.js';

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

export interface GrievanceHttpOptions {
  service: GrievanceFeedbackService;
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
  const e = err instanceof Cmp027Error ? err : mapPgError(err);
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

export function createGrievanceRoutes(opts: GrievanceHttpOptions): RouteDefinition[] {
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
      url: '/grievances',
      handle: wrap((ctx, r) =>
        service.file(ctx, r.body, header(r, 'idempotency-key'), 'GRIEVANCE'),
      ),
    },
    {
      method: 'POST',
      url: '/feedback',
      handle: wrap((ctx, r) => service.file(ctx, r.body, header(r, 'idempotency-key'), 'FEEDBACK')),
    },
    {
      method: 'GET',
      url: '/grievances/:grievanceId',
      handle: wrap((ctx, r) => service.get(ctx, param(r, 'grievanceId'))),
    },
    {
      method: 'GET',
      url: '/grievances/:grievanceId/transitions',
      handle: wrap((ctx, r) => service.listTransitions(ctx, param(r, 'grievanceId'))),
    },
    {
      method: 'GET',
      url: '/grievances/:grievanceId/responses',
      handle: wrap((ctx, r) => service.listResponses(ctx, param(r, 'grievanceId'))),
    },
    {
      method: 'POST',
      url: '/grievances/:grievanceId/commands',
      handle: wrap((ctx, r) =>
        service.executeCommand(ctx, param(r, 'grievanceId'), r.body, header(r, 'idempotency-key')),
      ),
    },
    {
      method: 'POST',
      url: '/grievances/:grievanceId/ai-assist',
      handle: wrap((ctx, r) =>
        service.recordAiAssist(ctx, param(r, 'grievanceId'), r.body, header(r, 'idempotency-key')),
      ),
    },
  ];
}

export function registerGrievanceRoutes(
  registrar: RouteRegistrar,
  opts: GrievanceHttpOptions,
): void {
  for (const route of createGrievanceRoutes(opts)) {
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
