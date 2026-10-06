import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../contracts.js';
import {
  assertNoTenantIdentifyingHeaders,
  requireTenantContext,
  type HeaderMap,
  type TenantContext,
} from '../context.js';
import { requestFingerprint } from '../domain/fingerprint.js';
import { IDEMPOTENCY_KEY, invalid, UUID } from '../domain/validate.js';
import { Cmp018Error, detail, mapPgError } from '../errors.js';
import {
  DEFAULT_PAGE,
  type Idempotency,
  type InspectionService,
} from '../service/inspection-service.js';

export interface HttpRequest {
  method: string;
  path: string;
  headers: HeaderMap;
  query?: Readonly<Record<string, string | undefined>>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type ContextResolver = (request: HttpRequest) => Promise<RequestContext | null>;

export interface HandlerDeps {
  service: InspectionService;
  resolveContext: ContextResolver;
}

interface Route {
  method: 'GET' | 'POST';
  template: string;
  pattern: RegExp;
  run: (a: {
    service: InspectionService;
    ctx: TenantContext;
    req: HttpRequest;
    inspectionId: string;
    idem: () => Idempotency;
  }) => Promise<{ status: number; body: unknown }>;
}

function route(
  method: Route['method'],
  template: string,
  pattern: RegExp,
  run: Route['run'],
): Route {
  return { method, template, pattern, run };
}

const ROUTES: readonly Route[] = [
  route('POST', '/v1/inspections', /^\/v1\/inspections$/, ({ service, ctx, req, idem }) =>
    service.createInspection(ctx, req.body, idem()),
  ),
  route(
    'GET',
    '/v1/inspections/available',
    /^\/v1\/inspections\/available$/,
    async ({ service, ctx, req }) => {
      const raw = req.query?.['limit'];
      const limit = raw === undefined ? DEFAULT_PAGE : Number(raw);
      return { status: 200, body: await service.listAvailable(ctx, limit) };
    },
  ),
  route(
    'GET',
    '/v1/inspections/{inspection_id}',
    /^\/v1\/inspections\/([0-9a-f-]{36})$/,
    async ({ service, ctx, inspectionId }) => ({
      status: 200,
      body: await service.getInspection(ctx, inspectionId),
    }),
  ),
  route(
    'GET',
    '/v1/inspections/{inspection_id}/detail',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/detail$/,
    async ({ service, ctx, inspectionId }) => ({
      status: 200,
      body: await service.getDetail(ctx, inspectionId),
    }),
  ),
  route(
    'GET',
    '/v1/inspections/{inspection_id}/history',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/history$/,
    async ({ service, ctx, inspectionId }) => ({
      status: 200,
      body: await service.getHistory(ctx, inspectionId),
    }),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/schedule',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/schedule$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.schedule(ctx, inspectionId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/reassign',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/reassign$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.reassign(ctx, inspectionId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/start',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/start$/,
    ({ service, ctx, inspectionId, idem }) => service.start(ctx, inspectionId, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/checklist',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/checklist$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.recordChecklist(ctx, inspectionId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/observations',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/observations$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.recordObservation(ctx, inspectionId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/evidence',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/evidence$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.attachEvidence(ctx, inspectionId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/findings',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/findings$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.recordFinding(ctx, inspectionId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/result',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/result$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.recordResult(ctx, inspectionId, req.body, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/complete',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/complete$/,
    ({ service, ctx, inspectionId, idem }) => service.complete(ctx, inspectionId, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/cancel',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/cancel$/,
    ({ service, ctx, inspectionId, idem }) => service.cancel(ctx, inspectionId, idem()),
  ),
  route(
    'POST',
    '/v1/inspections/{inspection_id}/reinspect',
    /^\/v1\/inspections\/([0-9a-f-]{36})\/reinspect$/,
    ({ service, ctx, req, inspectionId, idem }) =>
      service.reinspect(ctx, inspectionId, req.body, idem()),
  ),
];

function headerValue(headers: HeaderMap, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function errorResponse(correlationId: string, err: Cmp018Error): HttpResponse {
  const body: Record<string, unknown> = {
    error_code: err.code,
    message: err.message,
    correlation_id: correlationId,
  };
  if (err.details && err.details.length > 0) body['details'] = err.details;
  return { status: err.statusCode, headers: baseHeaders(), body };
}

function baseHeaders(): Record<string, string> {
  return { 'cache-control': 'private, no-store', 'content-type': 'application/json' };
}

export function createInspectionHandler(
  deps: HandlerDeps,
): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req) => {
    let correlationId: string = randomUUID();
    try {
      assertNoTenantIdentifyingHeaders(req.headers);
      const matched = ROUTES.map((r) => ({ r, m: r.pattern.exec(req.path) })).find(
        (x) => x.m !== null && x.r.method === req.method,
      );
      if (!matched || !matched.m) throw new Cmp018Error('SF-SYS-002');
      const ctx = requireTenantContext(await deps.resolveContext(req));
      correlationId = ctx.correlation_id;
      const inspectionId = matched.m[1] ?? '';
      if (matched.m[1] !== undefined && !UUID.test(inspectionId)) throw invalid('/inspection_id');
      const idem = (): Idempotency => {
        const key = headerValue(req.headers, 'idempotency-key');
        if (!key || !IDEMPOTENCY_KEY.test(key)) {
          throw new Cmp018Error('SF-SYS-003', detail('IDEMPOTENCY_KEY'));
        }
        return {
          key,
          endpoint: `${req.method} ${matched.r.template}`,
          fingerprint: requestFingerprint(req.method, req.path, req.body),
        };
      };
      const out = await matched.r.run({
        service: deps.service,
        ctx,
        req,
        inspectionId,
        idem,
      });
      return { status: out.status, headers: baseHeaders(), body: out.body };
    } catch (err) {
      return errorResponse(correlationId, err instanceof Cmp018Error ? err : mapPgError(err));
    }
  };
}
