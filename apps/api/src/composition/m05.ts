import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';

/**
 * Optional M05 mounts: CMP-015 application/case, CMP-017 tasks, CMP-018 inspection,
 * CMP-019 deficiency, CMP-027 grievance, CMP-028 appeal, CMP-029 SLA.
 *
 * CMP-016 workflow engine has no Fastify/HTTP registration surface — Temporal/workflow
 * stays behind ports. Do not invent a host HTTP API for CMP-016.
 *
 * CMP-036 API Gateway is already registered on the host in app.ts — do not remount it here.
 *
 * Same structural rules as Wave 1/2/M02/M03/M04: non-literal dynamic import so the host does not
 * merge sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Package specifiers are preferred (stitch may admit apps/api importers). File URLs are a
 * pre-lockfile fallback so host tests can load plugins without writing pnpm-lock.yaml
 * or apps/api/package.json in this envelope.
 *
 * Host composition adapts transport only. No domain logic, no cross-component SQL, and the
 * host is not the workflow/rules authority.
 *
 * CMP-019 and CMP-028 residuals remain GOVERNING_UNRESOLVED_UNWAIVED — carried, not waived.
 */
export interface M05PluginMounts {
  /** CMP-015 Application / Case. Uses published `registerApplicationCaseRoutes`. */
  applicationCase?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    prefix?: string;
  };
  /**
   * CMP-017 Work Queue / Tasks. Transport-neutral `createTaskHandler`; host adapts
   * Fastify ↔ HttpRequest/HttpResponse without semantic change.
   */
  tasks?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /**
   * CMP-018 Inspection / Verification. Transport-neutral `createInspectionHandler`.
   */
  inspection?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /**
   * CMP-019 Deficiency. Host adapts `createDeficiencyApi` / `buildDeficiencyApi`.handle only.
   * Residual GOVERNING_UNRESOLVED_UNWAIVED — do not fix here.
   */
  deficiency?: {
    pool?: unknown;
    repository?: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    slaClock?: unknown;
    caseCommands?: unknown;
    notifier?: unknown;
    clock?: () => Date;
  };
  /** CMP-027 Grievance & Feedback. Uses published `registerGrievanceRoutes`. */
  grievance?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    prefix?: string;
  };
  /**
   * CMP-028 Appeal / Review. Transport-neutral `createAppealHandler`.
   * Residual GOVERNING_UNRESOLVED_UNWAIVED — do not redesign CMP-015 boundary here.
   */
  appeal?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /**
   * CMP-029 SLA / Escalation. Host adapts `createSlaApi` / `buildSlaApi`.handle only.
   */
  sla?: {
    pool?: unknown;
    repository?: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
    notifier?: unknown;
    clock?: () => Date;
  };
}

interface NeutralRequest {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  query?: Readonly<Record<string, string | string[] | undefined>>;
  body?: unknown;
}

interface NeutralResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const fastifyRequestStore = new AsyncLocalStorage<FastifyRequest>();

async function loadModule<T>(specifiers: readonly string[]): Promise<T> {
  // Non-literal specifier → TypeScript does not pull the target into this program.
  let last: unknown;
  for (const specifier of specifiers) {
    try {
      return (await import(specifier)) as T;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function workspaceSpecifiers(pkg: string, srcIndexFromHere: string): string[] {
  return [pkg, new URL(srcIndexFromHere, import.meta.url).href];
}

function requestPath(request: FastifyRequest): string {
  const raw = request.url.split('?')[0] ?? request.url;
  return raw.length === 0 ? '/' : raw;
}

function toNeutralRequest(request: FastifyRequest): NeutralRequest {
  const query: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(request.query as Record<string, unknown>)) {
    if (typeof value === 'string' || value === undefined) {
      query[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      query[key] = value as string[];
    } else if (value != null) {
      query[key] = String(value);
    }
  }
  return {
    method: request.method,
    path: requestPath(request),
    headers: request.headers as Readonly<Record<string, string | string[] | undefined>>,
    query,
    body: request.body,
  };
}

function sendNeutral(reply: FastifyReply, res: NeutralResponse): unknown {
  let r = reply.code(res.status);
  for (const [name, value] of Object.entries(res.headers)) {
    r = r.header(name, value);
  }
  return r.send(res.body);
}

function fastifyUrlFromDescriptor(path: string): string {
  // Component descriptors use `:param`; Fastify uses the same. `{param}` → `:param`.
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
}

type NeutralHandler = (req: NeutralRequest) => Promise<NeutralResponse>;

async function mountNeutralRoutes(
  app: FastifyInstance,
  routes: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }>,
  handle: NeutralHandler,
): Promise<void> {
  const seen = new Set<string>();
  for (const route of routes) {
    const url = fastifyUrlFromDescriptor(route.path);
    const key = `${route.method} ${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    app.route({
      method: route.method,
      url,
      handler: async (request, reply) =>
        fastifyRequestStore.run(request, async () => {
          const res = await handle(toNeutralRequest(request));
          return sendNeutral(reply, res);
        }),
    });
  }
}

function bindResolveContext(
  resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>,
): (req: NeutralRequest) => Promise<RequestContext | null> {
  return async () => {
    const current = fastifyRequestStore.getStore();
    if (!current) return null;
    return resolveContext(current);
  };
}

function bindResolveContextFromHeaders(
  resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>,
): (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<RequestContext | null> {
  return async () => {
    const current = fastifyRequestStore.getStore();
    if (!current) return null;
    return resolveContext(current);
  };
}

/** Published CMP-017 path surface (host registration only; matching stays in the handler). */
const CMP017_ROUTES = [
  { method: 'POST' as const, path: '/v1/tasks' },
  { method: 'GET' as const, path: '/v1/tasks/available' },
  { method: 'GET' as const, path: '/v1/tasks/{task_id}' },
  { method: 'GET' as const, path: '/v1/tasks/{task_id}/history' },
  { method: 'POST' as const, path: '/v1/tasks/{task_id}/claim' },
  { method: 'POST' as const, path: '/v1/tasks/{task_id}/unclaim' },
  { method: 'POST' as const, path: '/v1/tasks/{task_id}/reassign' },
  { method: 'POST' as const, path: '/v1/tasks/{task_id}/complete' },
  { method: 'POST' as const, path: '/v1/tasks/{task_id}/cancel' },
];

/** Published CMP-018 path surface. */
const CMP018_ROUTES = [
  { method: 'POST' as const, path: '/v1/inspections' },
  { method: 'GET' as const, path: '/v1/inspections/available' },
  { method: 'GET' as const, path: '/v1/inspections/{inspection_id}' },
  { method: 'GET' as const, path: '/v1/inspections/{inspection_id}/detail' },
  { method: 'GET' as const, path: '/v1/inspections/{inspection_id}/history' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/schedule' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/reassign' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/start' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/checklist' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/observations' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/evidence' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/findings' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/result' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/complete' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/cancel' },
  { method: 'POST' as const, path: '/v1/inspections/{inspection_id}/reinspect' },
];

/** Published CMP-028 path surface. */
const CMP028_ROUTES = [
  { method: 'POST' as const, path: '/v1/appeals' },
  { method: 'GET' as const, path: '/v1/appeals/{appeal_id}' },
  { method: 'GET' as const, path: '/v1/appeals/{appeal_id}/history' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/admissibility' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/assign' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/reassign' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/review' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/hearing' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/decision' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/withdraw' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/cancel' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/workflow' },
  { method: 'POST' as const, path: '/v1/appeals/{appeal_id}/assist' },
];

/**
 * Registers M05 Fastify mounts under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other (no cross-component SQL).
 * Mount order: CMP-015, CMP-017, CMP-018, CMP-019, CMP-027, CMP-028, CMP-029.
 * CMP-016 is intentionally not mounted. CMP-036 is not remounted.
 */
export async function registerM05Plugins(
  app: FastifyInstance,
  mounts: M05PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.applicationCase) {
    const mod = await loadModule<{
      registerApplicationCaseRoutes: (
        registrar: FastifyInstance,
        opts: { service: unknown; resolveContext: (request: unknown) => Promise<unknown> },
      ) => unknown;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-015-application-case',
        '../../../../services/cmp-015-application-case/src/index.ts',
      ),
    );
    const { service, resolveContext, prefix } = mounts.applicationCase;
    await app.register(
      async (scoped) => {
        mod.registerApplicationCaseRoutes(scoped, {
          service,
          resolveContext: async (request) => resolveContext(request as FastifyRequest),
        });
      },
      { prefix: prefix ?? '/v1' },
    );
    mounted.push('CMP-015');
  }

  if (mounts.tasks) {
    const mod = await loadModule<{
      createTaskHandler: (deps: {
        service: unknown;
        resolveContext: (req: NeutralRequest) => Promise<RequestContext | null>;
      }) => NeutralHandler;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-017-work-queue-tasks',
        '../../../../services/cmp-017-work-queue-tasks/src/index.ts',
      ),
    );
    const handle = mod.createTaskHandler({
      service: mounts.tasks.service,
      resolveContext: bindResolveContext(mounts.tasks.resolveContext),
    });
    await mountNeutralRoutes(app, CMP017_ROUTES, handle);
    mounted.push('CMP-017');
  }

  if (mounts.inspection) {
    const mod = await loadModule<{
      createInspectionHandler: (deps: {
        service: unknown;
        resolveContext: (req: NeutralRequest) => Promise<RequestContext | null>;
      }) => NeutralHandler;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-018-inspection-verification',
        '../../../../services/cmp-018-inspection-verification/src/index.ts',
      ),
    );
    const handle = mod.createInspectionHandler({
      service: mounts.inspection.service,
      resolveContext: bindResolveContext(mounts.inspection.resolveContext),
    });
    await mountNeutralRoutes(app, CMP018_ROUTES, handle);
    mounted.push('CMP-018');
  }

  if (mounts.deficiency) {
    const mod = await loadModule<{
      buildDeficiencyApi: (opts: Record<string, unknown>) => { handle: NeutralHandler };
      ROUTE_DESCRIPTORS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-019-deficiency',
        '../../../../services/cmp-019-deficiency/src/index.ts',
      ),
    );
    const { resolveContext, ...rest } = mounts.deficiency;
    const api = mod.buildDeficiencyApi({
      ...rest,
      resolveContext: bindResolveContextFromHeaders(resolveContext),
    });
    await mountNeutralRoutes(app, mod.ROUTE_DESCRIPTORS, (req) => api.handle(req));
    mounted.push('CMP-019');
  }

  if (mounts.grievance) {
    const mod = await loadModule<{
      registerGrievanceRoutes: (
        registrar: FastifyInstance,
        opts: { service: unknown; resolveContext: (request: unknown) => Promise<unknown> },
      ) => void;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-027-grievance-feedback',
        '../../../../services/cmp-027-grievance-feedback/src/index.ts',
      ),
    );
    const { service, resolveContext, prefix } = mounts.grievance;
    await app.register(
      async (scoped) => {
        mod.registerGrievanceRoutes(scoped, {
          service,
          resolveContext: async (request) => resolveContext(request as FastifyRequest),
        });
      },
      { prefix: prefix ?? '/v1' },
    );
    mounted.push('CMP-027');
  }

  if (mounts.appeal) {
    const mod = await loadModule<{
      createAppealHandler: (deps: {
        service: unknown;
        resolveContext: (req: NeutralRequest) => Promise<RequestContext | null>;
      }) => NeutralHandler;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-028-appeal-review',
        '../../../../services/cmp-028-appeal-review/src/index.ts',
      ),
    );
    const handle = mod.createAppealHandler({
      service: mounts.appeal.service,
      resolveContext: bindResolveContext(mounts.appeal.resolveContext),
    });
    await mountNeutralRoutes(app, CMP028_ROUTES, handle);
    mounted.push('CMP-028');
  }

  if (mounts.sla) {
    const mod = await loadModule<{
      buildSlaApi: (opts: Record<string, unknown>) => { handle: NeutralHandler };
      ROUTE_DESCRIPTORS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-029-sla-escalation',
        '../../../../services/cmp-029-sla-escalation/src/index.ts',
      ),
    );
    const { resolveContext, ...rest } = mounts.sla;
    const api = mod.buildSlaApi({
      ...rest,
      resolveContext: bindResolveContextFromHeaders(resolveContext),
    });
    await mountNeutralRoutes(app, mod.ROUTE_DESCRIPTORS, (req) => api.handle(req));
    mounted.push('CMP-029');
  }

  return mounted;
}
