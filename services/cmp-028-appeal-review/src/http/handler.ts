import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../contracts.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type HeaderMap,
  type TenantContext,
} from '../context.js';
import { requestFingerprint } from '../domain/fingerprint.js';
import { IDEMPOTENCY_KEY, invalid, UUID } from '../domain/validate.js';
import { Cmp028Error, detail, mapPgError } from '../errors.js';
import type { AppealService, Idempotency } from '../service/appeal-service.js';

export interface HttpRequest {
  method: string;
  path: string;
  headers: HeaderMap;
  query?: Readonly<Record<string, string | undefined>>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type ContextResolver = (request: HttpRequest) => Promise<RequestContext | null>;

export interface HandlerDeps {
  service: AppealService;
  resolveContext: ContextResolver;
}

interface Route {
  method: 'GET' | 'POST';
  template: string;
  pattern: RegExp;
  run: (a: {
    service: AppealService;
    ctx: TenantContext;
    req: HttpRequest;
    appealId: string;
    idem: () => Idempotency;
  }) => Promise<{ status: number; body: unknown }>;
}

function route(
  method: Route['method'],
  template: string,
  pattern: RegExp,
  run: Route['run'],
): Route {
  return { method, template, pattern, run };
}

const ROUTES: readonly Route[] = [
  route('POST', '/v1/appeals', /^\/v1\/appeals$/, ({ service, ctx, req, idem }) =>
    service.fileAppeal(ctx, req.body, idem()),
  ),
  route(
    'GET',
    '/v1/appeals/{appeal_id}',
    /^\/v1\/appeals\/([0-9a-f-]{36})$/,
    async ({ service, ctx, appealId }) => ({
      status: 200,
      body: await service.getAppeal(ctx, appealId),
    }),
  ),
  route(
    'GET',
    '/v1/appeals/{appeal_id}/history',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/history$/,
    async ({ service, ctx, appealId }) => ({
      status: 200,
      body: await service.getHistory(ctx, appealId),
    }),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/admissibility',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/admissibility$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.recordAdmissibility(ctx, appealId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/assign',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/assign$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.assign(ctx, appealId, req.body, idem(), 'ASSIGN'),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/reassign',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/reassign$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.assign(ctx, appealId, req.body, idem(), 'REASSIGN'),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/review',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/review$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.recordReview(ctx, appealId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/hearing',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/hearing$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.recordHearing(ctx, appealId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/decision',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/decision$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.recordDecision(ctx, appealId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/withdraw',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/withdraw$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.withdrawOrCancel(ctx, appealId, req.body, idem(), 'WITHDRAW'),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/cancel',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/cancel$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.withdrawOrCancel(ctx, appealId, req.body, idem(), 'CANCEL'),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/workflow',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/workflow$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.linkWorkflow(ctx, appealId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/appeals/{appeal_id}/assist',
    /^\/v1\/appeals\/([0-9a-f-]{36})\/assist$/,
    ({ service, ctx, req, appealId, idem }) =>
      service.addAssistNote(ctx, appealId, req.body, idem()),
  ),
];

function headerValue(headers: HeaderMap, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function errorResponse(correlationId: string, err: Cmp028Error): HttpResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: baseHeaders(), body };
}

function baseHeaders(): Record<string, string> {
  return { 'cache-control': 'private, no-store', 'content-type': 'application/json' };
}

export function createAppealHandler(
  deps: HandlerDeps,
): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req) => {
    let correlationId: string = randomUUID();
    try {
      assertNoTenantIdentifyingHeaders(req.headers);
      const matched = ROUTES.map((r) => ({ r, m: r.pattern.exec(req.path) })).find(
        (x) => x.m !== null && x.r.method === req.method,
      );
      if (!matched || !matched.m) throw new Cmp028Error('SF-SYS-002');

      const ctx = requireTenantContext(await deps.resolveContext(req));
      correlationId = ctx.correlation_id;

      const appealId = matched.m[1] ?? '';
      if (matched.m[1] !== undefined && !UUID.test(appealId)) throw invalid('/appeal_id');
      const idem = (): Idempotency => {
        const key = headerValue(req.headers, 'idempotency-key');
        if (!key || !IDEMPOTENCY_KEY.test(key)) {
          throw new Cmp028Error('SF-SYS-003', detail('IDEMPOTENCY_KEY'));
        }
        return {
          key,
          endpoint: `${req.method} ${matched.r.template}`,
          fingerprint: requestFingerprint(req.method, req.path, req.body),
        };
      };
      const out = await matched.r.run({ service: deps.service, ctx, req, appealId, idem });
      return { status: out.status, headers: baseHeaders(), body: out.body };
    } catch (err) {
      return errorResponse(correlationId, err instanceof Cmp028Error ? err : mapPgError(err));
    }
  };
}
