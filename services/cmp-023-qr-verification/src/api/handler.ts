import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { Cmp023Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  validateEmptyInput,
  validateId,
  validateIssueToken,
  validateOpaqueToken,
} from '../service/input.js';
import type { CommandResult, Idempotency, QrVerificationService } from '../service/service.js';
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
    service: QrVerificationService,
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
 * QR routes. The public verify route returns the purpose-minimised view only. No route accepts,
 * stores or changes a registry status; status is read live from CMP-024 on every response.
 */
const ROUTES: Route[] = [
  route('POST', '/v1/qr/tokens', 'issueVerificationToken', true, (s, ctx, p) => {
    if (!p.idem) throw new Cmp023Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
    return s.issueToken(ctx, validateIssueToken(p.body), p.idem);
  }),
  route('GET', '/v1/qr/tokens/:token_id', 'getVerificationToken', false, (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.getToken(ctx, validateId(p.params['token_id'], '/token_id'));
  }),
  route('GET', '/v1/qr/verify/:opaque_token', 'verifyCredentialByToken', false, (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.verify(ctx, validateOpaqueToken(p.params['opaque_token']));
  }),
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

/** no-store: a cache must never serve a registry status CMP-024 did not just confirm. */
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'referrer-policy': 'no-referrer',
} as const;

function errorResponse(correlationId: string, err: Cmp023Error): ApiResponse {
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

export interface QrApiOptions {
  service: QrVerificationService;
  resolveContext: ContextResolver;
}

export function createQrApi(opts: QrApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp023Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp023Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        assertNoClientTime(req.query ?? {}, 'query');
        let idem: Idempotency | undefined;
        if (found.route.idempotent) {
          const key = header(req.headers, 'idempotency-key');
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp023Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
        const mapped = err instanceof Cmp023Error ? err : mapPgError(err);
        return errorResponse(correlationId, mapped);
      }
    },
  };
}
