import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { Cmp045Error, detail, mapPgError } from '../errors.js';
import {
  parseMetricQuery,
  parseUuidParam,
  validateDefinitionInput,
  validateEmptyInput,
} from '../service/input.js';
import type { CommandResult, Idempotency, AnalyticsService } from '../service/analytics-service.js';
import type { TenantContext } from '../types.js';

/**
 * Framework-neutral HTTP surface. The M08 host mount (SF-M08-007) adapts these routes to its server;
 * CMP-045 mounts nothing on apps/api and has no web-framework dependency.
 */
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
    service: AnalyticsService,
    ctx: TenantContext,
    p: {
      params: Record<string, string>;
      query: Readonly<Record<string, string | string[] | undefined>>;
      body: unknown;
      idem: Idempotency | undefined;
    },
  ): Promise<CommandResult>;
}

function requireIdem(idem: Idempotency | undefined): Idempotency {
  if (!idem) throw new Cmp045Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
  route('POST', '/v1/analytics/metric-definitions', 'createMetricDefinition', (s, ctx, p) =>
    s.createDefinition(ctx, validateDefinitionInput(p.body), requireIdem(p.idem)),
  ),
  route('GET', '/v1/analytics/metric-definitions', 'listMetricDefinitions', (s, ctx, p) => {
    for (const key of Object.keys(p.query)) {
      if (key !== 'metric_code')
        throw new Cmp045Error('SF-SYS-003', detail('UNKNOWN_PROPERTY', `/query/${key}`));
    }
    const code = p.query['metric_code'];
    if (Array.isArray(code))
      throw new Cmp045Error('SF-SYS-003', detail('SINGLE_VALUE_REQUIRED', '/query/metric_code'));
    return s.listDefinitions(ctx, code ?? null);
  }),
  route(
    'GET',
    '/v1/analytics/metric-definitions/:definition_id',
    'getMetricDefinition',
    (s, ctx, p) => s.getDefinition(ctx, pathUuid(p.params, 'definition_id')),
  ),
  route(
    'POST',
    '/v1/analytics/metric-definitions/:definition_id/retire',
    'retireMetricDefinition',
    (s, ctx, p) => {
      validateEmptyInput(p.body);
      return s.retireDefinition(ctx, pathUuid(p.params, 'definition_id'), requireIdem(p.idem));
    },
  ),
  route(
    'POST',
    '/v1/analytics/metric-definitions/:definition_id/rebuild',
    'rebuildMetricProjection',
    (s, ctx, p) => {
      validateEmptyInput(p.body);
      return s.rebuild(ctx, pathUuid(p.params, 'definition_id'), requireIdem(p.idem));
    },
  ),
  route('GET', '/v1/analytics/metrics', 'queryMetrics', (s, ctx, p) =>
    s.queryMetrics(ctx, parseMetricQuery(p.query)),
  ),
];

export const ROUTE_DESCRIPTORS: readonly RouteDescriptor[] = ROUTES.map(
  ({ method, path, operationId }) => ({ method, path, operationId }),
);

function pathUuid(params: Record<string, string>, name: string): string {
  return parseUuidParam(params[name], `/${name}`);
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

function errorResponse(correlationId: string, err: Cmp045Error): ApiResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: { ...SECURITY_HEADERS }, body };
}

export interface AnalyticsApiOptions {
  service: AnalyticsService;
  resolveContext: ContextResolver;
}

export function createAnalyticsApi(opts: AnalyticsApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp045Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp045Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        if (req.method.toUpperCase() === 'GET' && req.body !== undefined && req.body !== null) {
          throw new Cmp045Error('SF-SYS-003', detail('BODY_NOT_ALLOWED'));
        }
        let idem: Idempotency | undefined;
        const key = header(req.headers, 'idempotency-key');
        if (found.route.mutating) {
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp045Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
          query: req.query ?? {},
          body: req.body,
          idem,
        });
        return { status: result.status, headers: { ...SECURITY_HEADERS }, body: result.body };
      } catch (err) {
        const mapped = err instanceof Cmp045Error ? err : mapPgError(err);
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
