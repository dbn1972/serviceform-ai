import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp025Error, detail, mapPgError } from '../errors.js';
import { isTemplateRef } from '../domain/model.js';
import {
  assertNoClientTime,
  validateDispatchInput,
  validateEmptyInput,
  validatePublishTemplateInput,
  validateReceiptInput,
} from '../service/input.js';
import type { CommandResult, NotificationService, Idempotency } from '../service/service.js';
import type { TenantContext } from '../types.js';

export interface ApiRequest {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  query?: Readonly<Record<string, string | string[] | undefined>>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface RouteDescriptor {
  method: 'GET' | 'POST';
  path: string;
  operationId: string;
}

interface Route extends RouteDescriptor {
  segments: string[];
  mutating: boolean;
  run(
    service: NotificationService,
    ctx: TenantContext,
    p: { params: Record<string, string>; body: unknown; idem: Idempotency | undefined },
  ): Promise<CommandResult>;
}

function requireIdem(idem: Idempotency | undefined): Idempotency {
  if (!idem) throw new Cmp025Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
  return idem;
}

function route(
  method: 'GET' | 'POST',
  path: string,
  operationId: string,
  run: Route['run'],
): Route {
  return {
    method,
    path,
    operationId,
    segments: path.split('/').filter(Boolean),
    mutating: method === 'POST',
    run,
  };
}

const ROUTES: Route[] = [
  route('POST', '/v1/notifications', 'dispatchNotification', (s, ctx, p) =>
    s.dispatch(ctx, validateDispatchInput(p.body), requireIdem(p.idem)),
  ),
  route('GET', '/v1/notifications/:dispatch_id', 'getNotification', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.get(ctx, pathUuid(p.params, 'dispatch_id'));
  }),
  route('POST', '/v1/notifications/:dispatch_id/receipt', 'recordDeliveryReceipt', (s, ctx, p) =>
    s.recordReceipt(
      ctx,
      pathUuid(p.params, 'dispatch_id'),
      validateReceiptInput(p.body),
      requireIdem(p.idem),
    ),
  ),
  route('POST', '/v1/notification-templates', 'publishNotificationTemplate', (s, ctx, p) =>
    s.publishTemplate(ctx, validatePublishTemplateInput(p.body), requireIdem(p.idem)),
  ),
  route(
    'GET',
    '/v1/notification-templates/:template_ref',
    'listNotificationTemplateVersions',
    (s, ctx, p) => {
      validateEmptyInput(p.body);
      return s.listTemplateVersions(ctx, pathTemplateRef(p.params));
    },
  ),
];

export const ROUTE_DESCRIPTORS: readonly RouteDescriptor[] = ROUTES.map(
  ({ method, path, operationId }) => ({ method, path, operationId }),
);

function pathUuid(params: Record<string, string>, name: string): string {
  const v = params[name];
  if (v === undefined || !isUuid(v))
    throw new Cmp025Error('SF-SYS-003', detail('UUID_REQUIRED', `/${name}`));
  return v;
}

function pathTemplateRef(params: Record<string, string>): string {
  const v = params['template_ref'];
  if (v === undefined || !isTemplateRef(v)) {
    throw new Cmp025Error('SF-SYS-003', detail('REF_REQUIRED', '/template_ref'));
  }
  return v;
}

function match(
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | 'METHOD' | null {
  const parts = path.split('/').filter(Boolean);
  let pathMatched = false;
  for (const r of ROUTES) {
    if (r.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = r.segments.every((seg, i) => {
      const actual = parts[i] as string;
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = actual;
        return true;
      }
      return seg === actual;
    });
    if (!ok) continue;
    pathMatched = true;
    if (r.method === method) return { route: r, params };
  }
  return pathMatched ? 'METHOD' : null;
}

function header(headers: ApiRequest['headers'], name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
} as const;

function errorResponse(correlationId: string, err: Cmp025Error): ApiResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: { ...SECURITY_HEADERS }, body };
}

export interface NotificationApiOptions {
  service: NotificationService;
  resolveContext: ContextResolver;
}

export function createNotificationApi(opts: NotificationApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp025Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp025Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        assertNoClientTime(req.query ?? {}, 'query');
        let idem: Idempotency | undefined;
        const key = header(req.headers, 'idempotency-key');
        if (found.route.mutating) {
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp025Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
          }
          idem = {
            key,
            endpoint: `${found.route.method} ${found.route.path}`,
            fingerprint: requestFingerprint(
              found.route.method,
              requestTarget(found.route.path, found.params),
              req.body,
            ),
          };
        }
        const result = await found.route.run(opts.service, ctx, {
          params: found.params,
          body: req.body,
          idem,
        });
        return { status: result.status, headers: { ...SECURITY_HEADERS }, body: result.body };
      } catch (err) {
        const mapped = err instanceof Cmp025Error ? err : mapPgError(err);
        return errorResponse(correlationId, mapped);
      }
    },
  };
}

function requestTarget(template: string, params: Record<string, string>): string {
  return template
    .split('/')
    .map((seg) => (seg.startsWith(':') ? (params[seg.slice(1)] ?? seg) : seg))
    .join('/');
}
