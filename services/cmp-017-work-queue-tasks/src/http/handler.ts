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
import { Cmp017Error, detail, mapPgError } from '../errors.js';
import { DEFAULT_PAGE, type Idempotency, type TaskService } from '../service/task-service.js';

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
  service: TaskService;
  resolveContext: ContextResolver;
}

interface Route {
  method: 'GET' | 'POST';
  template: string;
  pattern: RegExp;
  run: (a: {
    service: TaskService;
    ctx: TenantContext;
    req: HttpRequest;
    taskId: string;
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
  route('POST', '/v1/tasks', /^\/v1\/tasks$/, ({ service, ctx, req, idem }) =>
    service.createTask(ctx, req.body, idem()),
  ),
  route('GET', '/v1/tasks/available', /^\/v1\/tasks\/available$/, async ({ service, ctx, req }) => {
    const raw = req.query?.['limit'];
    const limit = raw === undefined ? DEFAULT_PAGE : Number(raw);
    return { status: 200, body: await service.listAvailable(ctx, limit) };
  }),
  route(
    'GET',
    '/v1/tasks/{task_id}',
    /^\/v1\/tasks\/([0-9a-f-]{36})$/,
    async ({ service, ctx, taskId }) => ({
      status: 200,
      body: await service.getTask(ctx, taskId),
    }),
  ),
  route(
    'GET',
    '/v1/tasks/{task_id}/history',
    /^\/v1\/tasks\/([0-9a-f-]{36})\/history$/,
    async ({ service, ctx, taskId }) => ({
      status: 200,
      body: await service.getHistory(ctx, taskId),
    }),
  ),
  route(
    'POST',
    '/v1/tasks/{task_id}/claim',
    /^\/v1\/tasks\/([0-9a-f-]{36})\/claim$/,
    ({ service, ctx, taskId, idem }) => service.claimTask(ctx, taskId, idem()),
  ),
  route(
    'POST',
    '/v1/tasks/{task_id}/unclaim',
    /^\/v1\/tasks\/([0-9a-f-]{36})\/unclaim$/,
    ({ service, ctx, taskId, idem }) => service.unclaimTask(ctx, taskId, idem()),
  ),
  route(
    'POST',
    '/v1/tasks/{task_id}/reassign',
    /^\/v1\/tasks\/([0-9a-f-]{36})\/reassign$/,
    ({ service, ctx, req, taskId, idem }) => service.reassignTask(ctx, taskId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/tasks/{task_id}/complete',
    /^\/v1\/tasks\/([0-9a-f-]{36})\/complete$/,
    ({ service, ctx, req, taskId, idem }) => service.completeTask(ctx, taskId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/tasks/{task_id}/cancel',
    /^\/v1\/tasks\/([0-9a-f-]{36})\/cancel$/,
    ({ service, ctx, req, taskId, idem }) => service.cancelCloseTask(ctx, taskId, req.body, idem()),
  ),
];

function headerValue(headers: HeaderMap, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function errorResponse(correlationId: string, err: Cmp017Error): HttpResponse {
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

/**
 * Transport-neutral request handler. The host (apps/api, SF-M05-009) adapts its framework request
 * to HttpRequest; this component mounts nothing itself. Tenant is derived server-side only.
 */
export function createTaskHandler(deps: HandlerDeps): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req) => {
    let correlationId: string = randomUUID();
    try {
      assertNoTenantIdentifyingHeaders(req.headers);
      const matched = ROUTES.map((r) => ({ r, m: r.pattern.exec(req.path) })).find(
        (x) => x.m !== null && x.r.method === req.method,
      );
      if (!matched || !matched.m) throw new Cmp017Error('SF-SYS-002');

      const ctx = requireTenantContext(await deps.resolveContext(req));
      correlationId = ctx.correlation_id;

      const taskId = matched.m[1] ?? '';
      if (matched.m[1] !== undefined && !UUID.test(taskId)) throw invalid('/task_id');
      const idem = (): Idempotency => {
        const key = headerValue(req.headers, 'idempotency-key');
        if (!key || !IDEMPOTENCY_KEY.test(key)) {
          throw new Cmp017Error('SF-SYS-003', detail('IDEMPOTENCY_KEY'));
        }
        return {
          key,
          endpoint: `${req.method} ${matched.r.template}`,
          fingerprint: requestFingerprint(req.method, req.path, req.body),
        };
      };
      const out = await matched.r.run({ service: deps.service, ctx, req, taskId, idem });
      return { status: out.status, headers: baseHeaders(), body: out.body };
    } catch (err) {
      return errorResponse(correlationId, err instanceof Cmp017Error ? err : mapPgError(err));
    }
  };
}
