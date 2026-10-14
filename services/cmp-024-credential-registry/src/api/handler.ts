import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import type { RegistryCommand } from '../domain/status.js';
import { Cmp024Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  validateId,
  validateReadRequest,
  validateRegister,
  validateTransition,
} from '../service/input.js';
import type {
  CommandResult,
  CredentialRegistryService,
  CredentialStatusReader,
  Idempotency,
} from '../service/service.js';
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

export type RoutePort = 'READ' | 'COMMAND';

export interface RouteDescriptor {
  method: 'GET' | 'POST';
  path: string;
  operationId: string;
  port: RoutePort;
}

interface Params {
  params: Record<string, string>;
  body: unknown;
  query: Readonly<Record<string, string | string[] | undefined>>;
}

interface CommandRoute extends RouteDescriptor {
  method: 'POST';
  port: 'COMMAND';
  segments: string[];
  run(
    s: CredentialRegistryService,
    ctx: TenantContext,
    p: Params & { idem: Idempotency },
  ): Promise<CommandResult>;
}

/** Read routes are typed against CredentialStatusReader, which has no mutating method. */
interface ReadRoute extends RouteDescriptor {
  method: 'GET';
  port: 'READ';
  segments: string[];
  run(r: CredentialStatusReader, ctx: TenantContext, p: Params): Promise<CommandResult>;
}

type Route = CommandRoute | ReadRoute;

const BASE = '/v1/credential-registry/credentials';

function commandRoute(path: string, operationId: string, run: CommandRoute['run']): CommandRoute {
  return { method: 'POST', port: 'COMMAND', path, operationId, segments: split(path), run };
}

function readRoute(path: string, operationId: string, run: ReadRoute['run']): ReadRoute {
  return { method: 'GET', port: 'READ', path, operationId, segments: split(path), run };
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function transitionRoute(
  verb: string,
  command: RegistryCommand,
  operationId: string,
): CommandRoute {
  return commandRoute(`${BASE}/:credential_id/${verb}`, operationId, (s, ctx, p) =>
    s.transition(
      ctx,
      command,
      validateId(p.params['credential_id'], '/credential_id'),
      validateTransition(command, p.body),
      p.idem,
    ),
  );
}

const ROUTES: readonly Route[] = [
  commandRoute(BASE, 'registerCredential', (s, ctx, p) =>
    s.register(ctx, validateRegister(p.body), p.idem),
  ),
  readRoute(`${BASE}/:credential_id/status`, 'getCredentialStatus', (r, ctx, p) => {
    validateReadRequest(p.body, p.query);
    return r.readStatus(ctx, validateId(p.params['credential_id'], '/credential_id'));
  }),
  transitionRoute('activate', 'ACTIVATE', 'activateCredential'),
  transitionRoute('suspend', 'SUSPEND', 'suspendCredential'),
  transitionRoute('reinstate', 'REINSTATE', 'reinstateCredential'),
  transitionRoute('revoke', 'REVOKE', 'revokeCredential'),
  transitionRoute('reissue', 'REISSUE', 'reissueCredential'),
];

export const ROUTE_DESCRIPTORS: readonly RouteDescriptor[] = ROUTES.map(
  ({ method, path, operationId, port }) => ({ method, path, operationId, port }),
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

function errorResponse(correlationId: string, err: Cmp024Error): ApiResponse {
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

export interface RegistryApiOptions {
  service: CredentialRegistryService;
  resolveContext: ContextResolver;
}

export function createRegistryApi(opts: RegistryApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  const reader: CredentialStatusReader = Object.freeze({
    readStatus: (ctx: TenantContext, id: string) => opts.service.readStatus(ctx, id),
  });
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp024Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp024Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        const query = req.query ?? {};
        assertNoClientTime(query, 'query');
        const { route, params } = found;
        let result: CommandResult;
        if (route.port === 'READ') {
          result = await route.run(reader, ctx, { params, body: req.body, query });
        } else {
          const key = header(req.headers, 'idempotency-key');
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp024Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
          }
          const idem: Idempotency = {
            key,
            endpoint: `${route.method} ${route.path}`,
            fingerprint: requestFingerprint(
              route.method,
              requestTarget(route.path, params),
              req.body,
            ),
          };
          result = await route.run(opts.service, ctx, { params, body: req.body, query, idem });
        }
        return { status: result.status, headers: { ...SECURITY_HEADERS }, body: result.body };
      } catch (err) {
        const mapped = err instanceof Cmp024Error ? err : mapPgError(err);
        return errorResponse(correlationId, mapped);
      }
    },
  };
}
