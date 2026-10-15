import { randomUUID } from 'node:crypto';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type ContextResolver,
} from '../context.js';
import { IDEMPOTENCY_KEY, requestFingerprint } from '../domain/fingerprint.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp056Error, detail, mapPgError } from '../errors.js';
import {
  assertNoClientTime,
  validateAttendanceInput,
  validateBookInput,
  validateEmptyInput,
  validateNotificationInput,
  validateRescheduleInput,
  validateSlotInput,
  validateSlotQuery,
} from '../service/input.js';
import type { CommandResult, Idempotency, SchedulerService } from '../service/service.js';
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

type Query = Readonly<Record<string, string | string[] | undefined>>;

interface Route extends RouteDescriptor {
  segments: string[];
  mutating: boolean;
  run(
    service: SchedulerService,
    ctx: TenantContext,
    p: {
      params: Record<string, string>;
      body: unknown;
      query: Query;
      idem: Idempotency | undefined;
    },
  ): Promise<CommandResult>;
}

function requireIdem(idem: Idempotency | undefined): Idempotency {
  if (!idem) throw new Cmp056Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_REQUIRED'));
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

function noQuery(query: Query): void {
  const first = Object.keys(query)[0];
  if (first !== undefined)
    throw new Cmp056Error('SF-SYS-003', detail('UNKNOWN_FIELD', `/query/${first}`));
}

const ID = 'appointment_id';

/** Literal segments are matched before parameters, so /v1/appointments/slots is never an id. */
const ROUTES: Route[] = [
  route('POST', '/v1/appointment-slots', 'publishAppointmentSlot', (s, ctx, p) => {
    noQuery(p.query);
    return s.publishSlot(ctx, validateSlotInput(p.body), requireIdem(p.idem));
  }),
  route('GET', '/v1/appointments/slots', 'listAppointmentSlots', (s, ctx, p) => {
    validateEmptyInput(p.body);
    return s.listSlots(ctx, validateSlotQuery(p.query));
  }),
  route('POST', '/v1/appointments', 'bookAppointment', (s, ctx, p) => {
    noQuery(p.query);
    return s.book(ctx, validateBookInput(p.body), requireIdem(p.idem));
  }),
  route('GET', `/v1/appointments/:${ID}`, 'getAppointment', (s, ctx, p) => {
    noQuery(p.query);
    validateEmptyInput(p.body);
    return s.get(ctx, pathUuid(p.params, ID));
  }),
  route('POST', `/v1/appointments/:${ID}/reschedule`, 'rescheduleAppointment', (s, ctx, p) => {
    noQuery(p.query);
    return s.reschedule(
      ctx,
      pathUuid(p.params, ID),
      validateRescheduleInput(p.body),
      requireIdem(p.idem),
    );
  }),
  route('POST', `/v1/appointments/:${ID}/cancel`, 'cancelAppointment', (s, ctx, p) => {
    noQuery(p.query);
    validateEmptyInput(p.body);
    return s.cancel(ctx, pathUuid(p.params, ID), requireIdem(p.idem));
  }),
  route(
    'POST',
    `/v1/appointments/:${ID}/attendance`,
    'recordAppointmentAttendance',
    (s, ctx, p) => {
      noQuery(p.query);
      return s.recordAttendance(
        ctx,
        pathUuid(p.params, ID),
        validateAttendanceInput(p.body),
        requireIdem(p.idem),
      );
    },
  ),
  route(
    'POST',
    `/v1/appointments/:${ID}/notification-outcomes`,
    'recordAppointmentNotificationOutcome',
    (s, ctx, p) => {
      noQuery(p.query);
      return s.recordNotificationOutcome(
        ctx,
        pathUuid(p.params, ID),
        validateNotificationInput(p.body),
        requireIdem(p.idem),
      );
    },
  ),
];

export const ROUTE_DESCRIPTORS: readonly RouteDescriptor[] = ROUTES.map(
  ({ method, path, operationId }) => ({ method, path, operationId }),
);

function pathUuid(params: Record<string, string>, name: string): string {
  const v = params[name];
  if (v === undefined || !isUuid(v))
    throw new Cmp056Error('SF-SYS-003', detail('UUID_REQUIRED', `/${name}`));
  return v.toLowerCase();
}

function match(
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | 'METHOD' | null {
  const parts = path.split('/').filter(Boolean);
  let methodMismatch = false;
  for (const literalPass of [true, false]) {
    for (const r of ROUTES) {
      if (r.segments.length !== parts.length) continue;
      if (literalPass !== r.segments.every((seg) => !seg.startsWith(':'))) continue;
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
      if (r.method === method) return { route: r, params };
      methodMismatch = true;
    }
    if (methodMismatch) return 'METHOD';
  }
  return null;
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
  service: SchedulerService;
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
        const query = req.query ?? {};
        assertNoClientTime(query, 'query');
        let idem: Idempotency | undefined;
        const key = header(req.headers, 'idempotency-key');
        if (found.route.mutating) {
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
          query,
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
