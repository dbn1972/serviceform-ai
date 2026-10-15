import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { Cmp056Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  validateBookAppointment,
  validateEmptyInput,
  validateId,
  validatePublishSlot,
  validateRegisterType,
  validateReschedule,
  validateVersionedAction,
} from '../service/input.js';
import type { AppointmentSchedulerService, CommandResult, Idempotency } from '../service/service.js';
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
    service: AppointmentSchedulerService,
    ctx: TenantContext,
    p: {
      params: Record<string, string>;
      body: unknown;
      query: Readonly<Record<string, string | string[] | undefined>>;
      idem: Idempotency | undefined;
    },
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

function requireIdem(idem: Idempotency | undefined): Idempotency {
  if (!idem) throw new Cmp056Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
  return idem;
}

function queryOne(
  query: Readonly<Record<string, string | string[] | undefined>>,
  key: string,
): string | undefined {
  const v = query[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * INT-014 booking commands plus owner-supplied type/slot publication.
 * No route invents a statutory hearing/inspection calendar.
 */
const ROUTES: Route[] = [
  route('POST', '/v1/appointments/types', 'registerAppointmentType', (s, ctx, p) =>
    s.registerType(ctx, validateRegisterType(p.body), requireIdem(p.idem)),
  ),
  route('POST', '/v1/appointments/slots', 'publishAppointmentSlot', (s, ctx, p) =>
    s.publishSlot(ctx, validatePublishSlot(p.body), requireIdem(p.idem)),
  ),
  route('GET', '/v1/appointments/slots', 'listAppointmentSlots', (s, ctx, p) => {
    validateEmptyInput(p.body);
    const typeId = queryOne(p.query, 'appointment_type_id');
    return s.listSlots(
      ctx,
      typeId === undefined ? undefined : validateId(typeId, '/appointment_type_id'),
    );
  }),
  route('POST', '/v1/appointments', 'bookAppointment', (s, ctx, p) =>
    s.book(ctx, validateBookAppointment(p.body), requireIdem(p.idem)),
  ),
  route('GET', '/v1/appointments/:appointment_id', 'getAppointment', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.getAppointment(ctx, validateId(p.params['appointment_id'], '/appointment_id'));
  }),
  route(
    'POST',
    '/v1/appointments/:appointment_id/reschedule',
    'rescheduleAppointment',
    (s, ctx, p) =>
      s.reschedule(
        ctx,
        validateId(p.params['appointment_id'], '/appointment_id'),
        validateReschedule(p.body),
        requireIdem(p.idem),
      ),
  ),
  route('POST', '/v1/appointments/:appointment_id/cancel', 'cancelAppointment', (s, ctx, p) =>
    s.cancel(
      ctx,
      validateId(p.params['appointment_id'], '/appointment_id'),
      validateVersionedAction(p.body),
      requireIdem(p.idem),
    ),
  ),
  route('POST', '/v1/appointments/:appointment_id/complete', 'completeAppointment', (s, ctx, p) =>
    s.complete(
      ctx,
      validateId(p.params['appointment_id'], '/appointment_id'),
      validateVersionedAction(p.body),
      requireIdem(p.idem),
    ),
  ),
  route('POST', '/v1/appointments/:appointment_id/no-show', 'markAppointmentNoShow', (s, ctx, p) =>
    s.noShow(
      ctx,
      validateId(p.params['appointment_id'], '/appointment_id'),
      validateVersionedAction(p.body),
      requireIdem(p.idem),
    ),
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

function errorResponse(correlationId: string, err: Cmp056Error): ApiResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: { ...SECURITY_HEADERS }, body };
}

export interface SchedulerApiOptions {
  service: AppointmentSchedulerService;
  resolveContext: ContextResolver;
}

export function createSchedulerApi(opts: SchedulerApiOptions): {
  handle(req: ApiRequest): Promise<ApiResponse>;
} {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      let correlationId: string = randomUUID();
      try {
        assertNoTenantIdentifyingHeaders(req.headers);
        const found = match(req.method.toUpperCase(), req.path);
        if (found === null) throw new Cmp056Error('SF-SYS-002');
        if (found === 'METHOD') throw new Cmp056Error('SF-SYS-003', detail('METHOD_NOT_ALLOWED'));
        const ctx = requireTenantContext(await opts.resolveContext(req.headers));
        correlationId = ctx.correlation_id;
        assertNoClientTime(req.query ?? {}, 'query');
        let idem: Idempotency | undefined;
        if (found.route.mutating) {
          const key = header(req.headers, 'idempotency-key');
          if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
            throw new Cmp056Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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
          query: req.query ?? {},
          idem,
        });
        return { status: result.status, headers: { ...SECURITY_HEADERS }, body: result.body };
      } catch (err) {
        const mapped = err instanceof Cmp056Error ? err : mapPgError(err);
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
