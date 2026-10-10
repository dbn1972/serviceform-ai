import { randomUUID } from 'node:crypto';
import { assertNoTenantIdentifyingHeaders, type HeaderBag } from './context.js';
import { isRequestContext } from './domain/validate.js';
import { Cmp026Error, mapPgError } from './errors.js';
import type { MessagingService, ServiceResult } from './service.js';

export interface HttpRequestLike {
  headers: HeaderBag;
  params?: unknown;
  query?: unknown;
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

export interface MessagingHttpOptions {
  service: MessagingService;
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
  const e = err instanceof Cmp026Error ? err : mapPgError(err);
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

export function createMessagingRoutes(opts: MessagingHttpOptions): RouteDefinition[] {
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
  const key = (r: HttpRequestLike): unknown => header(r, 'idempotency-key');

  return [
    {
      method: 'POST',
      url: '/threads',
      handle: wrap((ctx, r) => service.openThread(ctx, r.body, key(r))),
    },
    {
      method: 'GET',
      url: '/applications/:applicationId/threads',
      handle: wrap((ctx, r) => service.listThreadsForApplication(ctx, param(r, 'applicationId'))),
    },
    {
      method: 'GET',
      url: '/threads/:threadId',
      handle: wrap((ctx, r) => service.getThread(ctx, param(r, 'threadId'))),
    },
    {
      method: 'GET',
      url: '/threads/:threadId/transitions',
      handle: wrap((ctx, r) => service.listTransitions(ctx, param(r, 'threadId'))),
    },
    {
      method: 'POST',
      url: '/threads/:threadId/commands',
      handle: wrap((ctx, r) => service.executeCommand(ctx, param(r, 'threadId'), r.body, key(r))),
    },
    {
      method: 'POST',
      url: '/threads/:threadId/participants',
      handle: wrap((ctx, r) => service.addParticipant(ctx, param(r, 'threadId'), r.body, key(r))),
    },
    {
      method: 'POST',
      url: '/threads/:threadId/participants/remove',
      handle: wrap((ctx, r) =>
        service.removeParticipant(ctx, param(r, 'threadId'), r.body, key(r)),
      ),
    },
    {
      method: 'POST',
      url: '/threads/:threadId/messages',
      handle: wrap((ctx, r) => service.sendMessage(ctx, param(r, 'threadId'), r.body, key(r))),
    },
    {
      method: 'GET',
      url: '/threads/:threadId/messages',
      handle: wrap((ctx, r) => service.listMessages(ctx, param(r, 'threadId'), r.query)),
    },
    {
      method: 'POST',
      url: '/threads/:threadId/messages/:messageId/retract',
      handle: wrap((ctx, r) =>
        service.retractMessage(ctx, param(r, 'threadId'), param(r, 'messageId'), r.body, key(r)),
      ),
    },
    {
      method: 'POST',
      url: '/threads/:threadId/messages/:messageId/acknowledge',
      handle: wrap((ctx, r) =>
        service.acknowledgeNotice(ctx, param(r, 'threadId'), param(r, 'messageId'), key(r)),
      ),
    },
    {
      method: 'POST',
      url: '/threads/:threadId/read',
      handle: wrap((ctx, r) => service.markRead(ctx, param(r, 'threadId'), r.body)),
    },
    {
      method: 'GET',
      url: '/threads/:threadId/attachments/:attachmentId/access',
      handle: wrap((ctx, r) =>
        service.getAttachmentAccess(ctx, param(r, 'threadId'), param(r, 'attachmentId')),
      ),
    },
  ];
}

export function registerMessagingRoutes(
  registrar: RouteRegistrar,
  opts: MessagingHttpOptions,
): void {
  for (const route of createMessagingRoutes(opts)) {
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
