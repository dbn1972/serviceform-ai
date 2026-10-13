import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { Cmp006Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  validateDiscoveryQuery,
  validateEmptyInput,
  validateId,
  validateSelection,
} from '../service/input.js';
import type { CommandResult, Idempotency, ServiceDiscoveryService } from '../service/service.js';
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
  idempotent: boolean;
  run(
    service: ServiceDiscoveryService,
    ctx: TenantContext,
    p: { params: Record<string, string>; body: unknown; idem: Idempotency | undefined },
  ): Promise<CommandResult>;
}

function route(
  method: 'GET' | 'POST',
  path: string,
  operationId: string,
  idempotent: boolean,
  run: Route['run'],
): Route {
  return { method, path, operationId, segments: path.split('/').filter(Boolean), idempotent, run };
}

/**
 * Discovery routes. Running a query records only CMP-006's own query log; the selection route is
 * the single INT-003 hand-off and it only emits an intent event. No route creates a form,
 * application or draft, and no result is a statutory eligibility decision.
 */
const ROUTES: Route[] = [
  route('POST', '/v1/discovery/queries', 'runDiscoveryQuery', false, (s, ctx, p) =>
    s.query(ctx, validateDiscoveryQuery(p.body)),
  ),
  route('GET', '/v1/discovery/queries/:query_id', 'getDiscoveryQuery', false, (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.getQuery(ctx, validateId(p.params['query_id'], '/query_id'));
  }),
  route(
    'POST',
    '/v1/discovery/queries/:query_id/selections',
    'selectDiscoveredService',
    true,
    (s, ctx, p) => {
      if (!p.idem) throw new Cmp006Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
      return s.selectService(
        ctx,
        validateId(p.params['query_id'], '/query_id'),
        validateSelection(p.body),
        p.idem,
      );
    },
  ),
];

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

function errorResponse(correlationId: string, err: Cmp006Error): ApiResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: { ...SECURITY_HEADERS }, body };
}

function requestTarget(template: string, params: Record<string, string>): string {
  return template
    .split('/')
    .map((seg) => (seg.startsWith(':') ? (params[seg.slice(1)] ?? seg) : seg))
    .join('/');
}

export interface DiscoveryApiOptions {
  service: ServiceDiscoveryService;
  resolveContext: ContextResolver;
}

export function createDiscoveryApi(opts: DiscoveryApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp006Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp006Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        assertNoClientTime(req.query ?? {}, 'query');
        let idem: Idempotency | undefined;
        if (found.route.idempotent) {
          const key = header(req.headers, 'idempotency-key');
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp006Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
        const mapped = err instanceof Cmp006Error ? err : mapPgError(err);
        return errorResponse(correlationId, mapped);
      }
    },
  };
}
