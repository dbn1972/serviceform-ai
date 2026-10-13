import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';

/**
 * Optional M08 mounts: CMP-035 search, CMP-007 recommendation, CMP-045 analytics/MIS,
 * CMP-046 operational dashboard, CMP-049 data retention, CMP-006 service discovery.
 *
 * Same structural rules as M02–M06: non-literal dynamic import so the host does not
 * merge sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Package specifiers are preferred (stitch admitted workspace importers). File URLs are a
 * pre-lockfile fallback so host tests can load plugins without writing pnpm-lock.yaml
 * or apps/api/package.json in this envelope.
 *
 * Host composition adapts transport only. No domain logic, no cross-component SQL, no
 * retention periods (CMP-049 binds period references owned by policy metadata), and the
 * host is never the recommendation/eligibility authority.
 *
 * CMP-036 API Gateway is already registered on the host in app.ts — do not remount it here.
 * Hard serial vs SF-M06-005 (must_not_run_concurrent_with); M06 mounts are left untouched.
 */
export interface M08PluginMounts {
  /**
   * CMP-035 Search & Indexing. Published `registerSearchRoutes` under `/v1`
   * (component paths are relative: `/search/queries`, …).
   */
  search?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    prefix?: string;
  };
  /**
   * CMP-007 Recommendation. Published `recommendationPlugin`; the component builds its own
   * service from the supplied ports (repository/pool, authorizer, catalogue, consent,
   * profile, gateway). Advisory only — never a binding outcome.
   */
  recommendation?: {
    options: Record<string, unknown>;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    prefix?: string;
  };
  /** CMP-045 Analytics & MIS. Transport-neutral `createAnalyticsApi` / `.handle`. */
  analytics?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-046 Operational Dashboard. Transport-neutral `createOpsDashboardApi` / `.handle`. */
  ops?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-049 Data Retention. Transport-neutral `createRetentionApi` / `.handle`. */
  retention?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-006 Service Discovery. Transport-neutral `createDiscoveryApi` / `.handle`. */
  discovery?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
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

type NeutralHandler = (req: NeutralRequest) => Promise<NeutralResponse>;
type HeaderContextResolver = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<RequestContext | null>;
type RouteDescriptors = ReadonlyArray<{ method: 'GET' | 'POST'; path: string }>;

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
  // Pass Fastify's already-parsed query through read-only. Do not re-assign into a new
  // object with user-controlled keys (CodeQL js/remote-property-injection).
  return {
    method: request.method,
    path: requestPath(request),
    headers: request.headers as Readonly<Record<string, string | string[] | undefined>>,
    query: request.query as Readonly<Record<string, string | string[] | undefined>>,
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
  // Component descriptors may use `:param` or `{param}`; Fastify uses `:param`.
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
}

async function mountNeutralRoutes(
  app: FastifyInstance,
  routes: RouteDescriptors,
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

function bindResolveContextFromHeaders(
  resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>,
): HeaderContextResolver {
  return async () => {
    const current = fastifyRequestStore.getStore();
    if (!current) return null;
    return resolveContext(current);
  };
}

type NeutralModule = Record<string, unknown> & { ROUTE_DESCRIPTORS: RouteDescriptors };
type NeutralFactory = (opts: { service: unknown; resolveContext: HeaderContextResolver }) => {
  handle: NeutralHandler;
};

async function mountNeutralComponent(
  app: FastifyInstance,
  mount: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  },
  pkg: string,
  srcIndex: string,
  factoryName: string,
): Promise<void> {
  const mod = await loadModule<NeutralModule>(workspaceSpecifiers(pkg, srcIndex));
  const factory = mod[factoryName] as NeutralFactory;
  const api = factory({
    service: mount.service,
    resolveContext: bindResolveContextFromHeaders(mount.resolveContext),
  });
  await mountNeutralRoutes(app, mod.ROUTE_DESCRIPTORS, (req) => api.handle(req));
}

/**
 * Registers M08 Fastify mounts under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other (no cross-component SQL).
 * Mount order: CMP-035, CMP-007, CMP-045, CMP-046, CMP-049, CMP-006.
 * CMP-036 is not remounted.
 */
export async function registerM08Plugins(
  app: FastifyInstance,
  mounts: M08PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.search) {
    const mod = await loadModule<{
      registerSearchRoutes: (
        registrar: FastifyInstance,
        opts: { service: unknown; resolveContext: (request: unknown) => Promise<unknown> },
      ) => void;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-035-search-indexing',
        '../../../../services/cmp-035-search-indexing/src/index.ts',
      ),
    );
    const { service, resolveContext, prefix } = mounts.search;
    await app.register(
      async (scoped) => {
        mod.registerSearchRoutes(scoped, {
          service,
          resolveContext: async (request) => resolveContext(request as FastifyRequest),
        });
      },
      { prefix: prefix ?? '/v1' },
    );
    mounted.push('CMP-035');
  }

  if (mounts.recommendation) {
    const mod = await loadModule<{
      recommendationPlugin: (app: FastifyInstance, opts: Record<string, unknown>) => Promise<void>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-007-recommendation',
        '../../../../services/cmp-007-recommendation/src/index.ts',
      ),
    );
    const { options, resolveContext, prefix } = mounts.recommendation;
    await app.register(mod.recommendationPlugin, {
      ...options,
      resolveContext,
      prefix: prefix ?? '/v1',
    });
    mounted.push('CMP-007');
  }

  if (mounts.analytics) {
    await mountNeutralComponent(
      app,
      mounts.analytics,
      '@serviceform/cmp-045-analytics-mis',
      '../../../../services/cmp-045-analytics-mis/src/index.ts',
      'createAnalyticsApi',
    );
    mounted.push('CMP-045');
  }

  if (mounts.ops) {
    await mountNeutralComponent(
      app,
      mounts.ops,
      '@serviceform/cmp-046-operational-dashboard',
      '../../../../services/cmp-046-operational-dashboard/src/index.ts',
      'createOpsDashboardApi',
    );
    mounted.push('CMP-046');
  }

  if (mounts.retention) {
    await mountNeutralComponent(
      app,
      mounts.retention,
      '@serviceform/cmp-049-data-retention',
      '../../../../services/cmp-049-data-retention/src/index.ts',
      'createRetentionApi',
    );
    mounted.push('CMP-049');
  }

  if (mounts.discovery) {
    await mountNeutralComponent(
      app,
      mounts.discovery,
      '@serviceform/cmp-006-service-discovery',
      '../../../../services/cmp-006-service-discovery/src/index.ts',
      'createDiscoveryApi',
    );
    mounted.push('CMP-006');
  }

  return mounted;
}
