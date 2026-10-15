import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { Cmp061Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  validateDenyRequest,
  validateEmptyInput,
  validateId,
  validateSubmitRequest,
  validateTaskOutcome,
} from '../service/input.js';
import type { CommandResult, Idempotency, PrivacyCentreService } from '../service/service.js';
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
    service: PrivacyCentreService,
    ctx: TenantContext,
    p: { params: Record<string, string>; body: unknown; idem: Idempotency | undefined },
  ): Promise<CommandResult>;
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

/**
 * Privacy Centre routes. The Centre records rights requests and orchestrates owner-domain
 * fulfilment tasks via outbox events. No route mutates another component's tables
 * (cross_component_direct_mutation_forbidden / owner_task_orchestration_only).
 */
const ROUTES: Route[] = [
  route('GET', '/v1/privacy/me', 'getPrivacyMe', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.getMe(ctx);
  }),
  route('GET', '/v1/privacy/me/consents', 'getPrivacyConsents', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.getConsents(ctx);
  }),
  route('POST', '/v1/privacy/requests', 'submitPrivacyRequest', (s, ctx, p) =>
    s.submitRequest(ctx, validateSubmitRequest(p.body), requireIdem(p.idem)),
  ),
  route('GET', '/v1/privacy/requests/:request_id', 'getPrivacyRequest', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.getRequest(ctx, validateId(p.params['request_id'], '/request_id'));
  }),
  route(
    'POST',
    '/v1/privacy/requests/:request_id/tasks',
    'requestPrivacyOwnerTasks',
    (s, ctx, p) => {
      validateEmptyInput(p.body);
      return s.requestOwnerTasks(
        ctx,
        validateId(p.params['request_id'], '/request_id'),
        requireIdem(p.idem),
      );
    },
  ),
  route(
    'POST',
    '/v1/privacy/requests/:request_id/withdraw',
    'withdrawPrivacyRequest',
    (s, ctx, p) => {
      validateEmptyInput(p.body);
      return s.withdrawRequest(
        ctx,
        validateId(p.params['request_id'], '/request_id'),
        requireIdem(p.idem),
      );
    },
  ),
  route('POST', '/v1/privacy/requests/:request_id/deny', 'denyPrivacyRequest', (s, ctx, p) =>
    s.denyRequest(
      ctx,
      validateId(p.params['request_id'], '/request_id'),
      validateDenyRequest(p.body),
      requireIdem(p.idem),
    ),
  ),
  route(
    'POST',
    '/v1/privacy/requests/:request_id/complete',
    'completePrivacyRequest',
    (s, ctx, p) => {
      validateEmptyInput(p.body);
      return s.completeRequest(
        ctx,
        validateId(p.params['request_id'], '/request_id'),
        requireIdem(p.idem),
      );
    },
  ),
  route('POST', '/v1/privacy/tasks/:task_id/outcomes', 'recordPrivacyTaskOutcome', (s, ctx, p) =>
    s.recordTaskOutcome(
      ctx,
      validateId(p.params['task_id'], '/task_id'),
      validateTaskOutcome(p.body),
      requireIdem(p.idem),
    ),
  ),
];

function requireIdem(idem: Idempotency | undefined): Idempotency {
  if (!idem) throw new Cmp061Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
  return idem;
}

export const ROUTE_DESCRIPTORS: readonly RouteDescriptor[] = ROUTES.map(
  ({ method, path, operationId }) => ({ method, path, operationId }),
);

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

function errorResponse(correlationId: string, err: Cmp061Error): ApiResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: { ...SECURITY_HEADERS }, body };
}

export interface PrivacyApiOptions {
  service: PrivacyCentreService;
  resolveContext: ContextResolver;
}

export function createPrivacyApi(opts: PrivacyApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp061Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp061Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        assertNoClientTime(req.query ?? {}, 'query');
        let idem: Idempotency | undefined;
        if (found.route.mutating) {
          const key = header(req.headers, 'idempotency-key');
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp061Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
        const mapped = err instanceof Cmp061Error ? err : mapPgError(err);
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
