import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { Cmp057Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  validateApplicationLink,
  validateBindApplicant,
  validateClose,
  validateId,
  validateReadRequest,
  validateRepresentation,
  validateResume,
  validateStart,
} from '../service/input.js';
import type { AssistedSessionService, Idempotency } from '../service/service.js';
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
    service: AssistedSessionService,
    ctx: TenantContext,
    p: { params: Record<string, string>; body: unknown; idem: Idempotency | undefined },
  ): Promise<{ status: number; body: unknown }>;
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
 * Assisted/omnichannel session routes (INT-015). No route invents representation statute;
 * authority arrives only as an opaque owner-supplied ref. Tenant from server context only.
 */
const ROUTES: Route[] = [
  route('POST', '/v1/assisted/sessions', 'startAssistedSession', (s, ctx, p) =>
    s.start(ctx, validateStart(p.body), requireIdem(p.idem)),
  ),
  route('GET', '/v1/assisted/sessions/:session_id', 'getAssistedSession', (s, ctx, p) => {
    validateReadRequest(p.body, {});
    return s.readSession(ctx, validateId(p.params['session_id'], '/session_id'));
  }),
  route(
    'POST',
    '/v1/assisted/sessions/:session_id/applicant',
    'bindAssistedApplicant',
    (s, ctx, p) =>
      s.bindApplicant(
        ctx,
        validateId(p.params['session_id'], '/session_id'),
        validateBindApplicant(p.body),
        requireIdem(p.idem),
      ),
  ),
  route(
    'POST',
    '/v1/assisted/sessions/:session_id/representation',
    'verifyAssistedRepresentation',
    (s, ctx, p) =>
      s.verifyRepresentation(
        ctx,
        validateId(p.params['session_id'], '/session_id'),
        validateRepresentation(p.body),
        requireIdem(p.idem),
      ),
  ),
  route(
    'POST',
    '/v1/assisted/sessions/:session_id/submit',
    'submitAssistedApplication',
    (s, ctx, p) =>
      s.submit(
        ctx,
        validateId(p.params['session_id'], '/session_id'),
        validateApplicationLink(p.body),
        requireIdem(p.idem),
      ),
  ),
  route(
    'POST',
    '/v1/assisted/sessions/:session_id/handoff',
    'handoffAssistedSession',
    (s, ctx, p) =>
      s.handoff(
        ctx,
        validateId(p.params['session_id'], '/session_id'),
        validateApplicationLink(p.body),
        requireIdem(p.idem),
      ),
  ),
  route(
    'POST',
    '/v1/assisted/sessions/:session_id/resume',
    'resumeAssistedSession',
    (s, ctx, p) =>
      s.resume(
        ctx,
        validateId(p.params['session_id'], '/session_id'),
        validateResume(p.body),
        requireIdem(p.idem),
      ),
  ),
  route(
    'POST',
    '/v1/assisted/sessions/:session_id/close',
    'closeAssistedSession',
    (s, ctx, p) =>
      s.close(
        ctx,
        validateId(p.params['session_id'], '/session_id'),
        validateClose(p.body),
        requireIdem(p.idem),
      ),
  ),
];

function requireIdem(idem: Idempotency | undefined): Idempotency {
  if (!idem) throw new Cmp057Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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

function errorResponse(correlationId: string, err: Cmp057Error): ApiResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: { ...SECURITY_HEADERS }, body };
}

export interface AssistedApiOptions {
  service: AssistedSessionService;
  resolveContext: ContextResolver;
}

export function createAssistedApi(opts: AssistedApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp057Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp057Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        assertNoClientTime(req.query ?? {}, 'query');
        let idem: Idempotency | undefined;
        if (found.route.mutating) {
          const key = header(req.headers, 'idempotency-key');
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp057Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
        const mapped = err instanceof Cmp057Error ? err : mapPgError(err);
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
