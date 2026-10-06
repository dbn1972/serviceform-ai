import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp029Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  asRecord,
  validateCalendarInput,
  validateCompleteInput,
  validateEmptyInput,
  validatePauseInput,
  validatePolicyInput,
  validateStartInput,
} from '../service/input.js';
import type { CommandResult, Idempotency, SlaService } from '../service/sla-service.js';
import type { TenantContext } from '../types.js';

/**
 * Framework-neutral HTTP surface. The M05 host (SF-M05-009) adapts these routes to its server;
 * CMP-029 mounts nothing on apps/api and has no web-framework dependency.
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
    service: SlaService,
    ctx: TenantContext,
    p: { params: Record<string, string>; body: unknown; idem: Idempotency | undefined },
  ): Promise<CommandResult>;
}

function requireIdem(idem: Idempotency | undefined): Idempotency {
  if (!idem) throw new Cmp029Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
  route('POST', '/v1/sla-calendars', 'createSlaCalendar', (s, ctx, p) =>
    s.createCalendar(ctx, validateCalendarInput(p.body), requireIdem(p.idem)),
  ),
  route('POST', '/v1/sla-policies', 'createSlaPolicy', (s, ctx, p) =>
    s.createPolicy(ctx, validatePolicyInput(p.body), requireIdem(p.idem)),
  ),
  route('POST', '/v1/sla-policies/:policy_id/retire', 'retireSlaPolicy', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.retirePolicy(ctx, pathUuid(p.params, 'policy_id'), requireIdem(p.idem));
  }),
  route('POST', '/v1/sla-clocks', 'startSlaClock', (s, ctx, p) =>
    s.start(ctx, validateStartInput(p.body), requireIdem(p.idem)),
  ),
  route('GET', '/v1/sla-clocks/:clock_id', 'getSlaClock', (s, ctx, p) =>
    s.getClock(ctx, pathUuid(p.params, 'clock_id')),
  ),
  route('GET', '/v1/sla-clocks/:clock_id/history', 'getSlaClockHistory', (s, ctx, p) =>
    s.getHistory(ctx, pathUuid(p.params, 'clock_id')),
  ),
  route('POST', '/v1/sla-clocks/:clock_id/pause', 'pauseSlaClock', (s, ctx, p) =>
    s.pause(ctx, pathUuid(p.params, 'clock_id'), validatePauseInput(p.body), requireIdem(p.idem)),
  ),
  route('POST', '/v1/sla-clocks/:clock_id/resume', 'resumeSlaClock', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.resume(ctx, pathUuid(p.params, 'clock_id'), requireIdem(p.idem));
  }),
  route('POST', '/v1/sla-clocks/:clock_id/complete', 'completeSlaClock', (s, ctx, p) =>
    s.complete(
      ctx,
      pathUuid(p.params, 'clock_id'),
      validateCompleteInput(p.body),
      requireIdem(p.idem),
    ),
  ),
  route('POST', '/v1/sla-clocks/:clock_id/evaluate', 'evaluateSlaClock', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.evaluate(ctx, pathUuid(p.params, 'clock_id'), requireIdem(p.idem));
  }),
  route(
    'GET',
    '/v1/applications/:application_id/sla-clocks',
    'listApplicationSlaClocks',
    (s, ctx, p) => s.clocksForApplication(ctx, pathUuid(p.params, 'application_id')),
  ),
];

export const ROUTE_DESCRIPTORS: readonly RouteDescriptor[] = ROUTES.map(
  ({ method, path, operationId }) => ({ method, path, operationId }),
);

function pathUuid(params: Record<string, string>, name: string): string {
  const v = params[name];
  if (v === undefined || !isUuid(v))
    throw new Cmp029Error('SF-SYS-003', detail('UUID_REQUIRED', `/${name}`));
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

function errorResponse(correlationId: string, err: Cmp029Error): ApiResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: { ...SECURITY_HEADERS }, body };
}

export interface SlaApiOptions {
  service: SlaService;
  resolveContext: ContextResolver;
}

export function createSlaApi(opts: SlaApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp029Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp029Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        assertNoClientTime(req.query ?? {}, 'query');
        if (req.method.toUpperCase() === 'GET' && req.body !== undefined && req.body !== null) {
          asRecord(req.body);
          assertNoClientTime(asRecord(req.body), 'body');
        }
        let idem: Idempotency | undefined;
        const key = header(req.headers, 'idempotency-key');
        if (found.route.mutating) {
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp029Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
        const mapped = err instanceof Cmp029Error ? err : mapPgError(err);
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
