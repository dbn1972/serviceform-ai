import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { sanitizeRequestForLog } from '@serviceform/observability';

/**
 * Optional M09 mounts: CMP-056 scheduler, CMP-057 assisted, CMP-058 semantic registry,
 * CMP-059 migration workbench, CMP-060 risk/integrity, CMP-061 privacy centre.
 *
 * Neutral APIs (056/057/061) publish `create*Api` / `.handle` plus `ROUTE_DESCRIPTORS`
 * with `/v1` paths already — no extra prefix.
 *
 * Fastify plugins (058/059) register under `prefix` default `/v1` with relative routes.
 * CMP-060 exports `registerRiskRoutes` with absolute `/v1/...` paths.
 *
 * Non-literal dynamic import so the host does not merge sibling Fastify module-augmentation
 * graphs. Transport adaptation only — no domain logic, no cross-component SQL.
 *
 * CMP-036 remains registered in app.ts — do not remount it here.
 * Hard serial vs SF-M10-HOST.
 */
export interface M09PluginMounts {
  /** CMP-056 Appointment / Scheduler. Neutral `createSchedulerApi`. */
  scheduler?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-057 Assisted / Omnichannel. Neutral `createAssistedApi`. */
  assisted?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-058 Semantic Registry. Fastify `semanticPlugin` / `registerSemantic`. */
  semantic?: {
    options: Record<string, unknown>;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    prefix?: string;
  };
  /** CMP-059 Migration Workbench. Fastify `migrationPlugin` / `registerMigration`. */
  migration?: {
    options: Record<string, unknown>;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    prefix?: string;
  };
  /** CMP-060 Risk / Integrity. `registerRiskRoutes` with absolute `/v1` paths. */
  risk?: {
    options: Record<string, unknown>;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-061 Privacy Rights Centre. Neutral `createPrivacyApi`. */
  privacy?: {
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
type RouteDescriptors = ReadonlyArray<{
  method: 'GET' | 'POST';
  path: string;
  logRedactedParams?: readonly string[];
}>;

const fastifyRequestStore = new AsyncLocalStorage<FastifyRequest>();

async function loadModule<T>(specifiers: readonly string[]): Promise<T> {
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
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
}

function logRedactingReqSerializer(
  template: string,
  redacted: readonly string[],
): (req: unknown) => Record<string, unknown> {
  const tpl = template.split('/');
  const names = new Set(redacted);
  return (req) => {
    const out = sanitizeRequestForLog(
      (req ?? {}) as { id?: unknown; method?: unknown; url?: unknown },
    );
    if (typeof out['url'] === 'string') {
      const parts = out['url'].split('/');
      out['url'] =
        parts.length === tpl.length
          ? parts
              .map((part, i) => {
                const seg = tpl[i] ?? '';
                return seg.startsWith(':') && names.has(seg.slice(1)) ? seg : part;
              })
              .join('/')
          : template;
    }
    return out;
  };
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
    const redacted = route.logRedactedParams ?? [];
    app.route({
      method: route.method,
      url,
      ...(redacted.length > 0
        ? { logSerializers: { req: logRedactingReqSerializer(url, redacted) } }
        : {}),
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
 * Registers M09 Fastify mounts under Eng `/v1` paths.
 * Mount order: CMP-056, CMP-057, CMP-058, CMP-059, CMP-060, CMP-061.
 * CMP-036 is not remounted. Call only from the API host.
 */
export async function registerM09Plugins(
  app: FastifyInstance,
  mounts: M09PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.scheduler) {
    await mountNeutralComponent(
      app,
      mounts.scheduler,
      '@serviceform/cmp-056-scheduler',
      '../../../../services/cmp-056-scheduler/src/index.ts',
      'createSchedulerApi',
    );
    mounted.push('CMP-056');
  }

  if (mounts.assisted) {
    await mountNeutralComponent(
      app,
      mounts.assisted,
      '@serviceform/cmp-057-assisted-service',
      '../../../../services/cmp-057-assisted-service/src/index.ts',
      'createAssistedApi',
    );
    mounted.push('CMP-057');
  }

  if (mounts.semantic) {
    const mod = await loadModule<{
      semanticPlugin: FastifyPluginAsync<Record<string, unknown>>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-058-semantic-registry',
        '../../../../services/cmp-058-semantic-registry/src/index.ts',
      ),
    );
    const { options, resolveContext, prefix } = mounts.semantic;
    await app.register(mod.semanticPlugin, {
      ...options,
      resolveContext,
      prefix: prefix ?? '/v1',
    });
    mounted.push('CMP-058');
  }

  if (mounts.migration) {
    const mod = await loadModule<{
      migrationPlugin: FastifyPluginAsync<Record<string, unknown>>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-059-migration-workbench',
        '../../../../services/cmp-059-migration-workbench/src/index.ts',
      ),
    );
    const { options, resolveContext, prefix } = mounts.migration;
    await app.register(mod.migrationPlugin, {
      ...options,
      resolveContext,
      prefix: prefix ?? '/v1',
    });
    mounted.push('CMP-059');
  }

  if (mounts.risk) {
    const mod = await loadModule<{
      registerRiskRoutes: (
        registrar: FastifyInstance,
        opts: Record<string, unknown> & {
          resolveContext: HeaderContextResolver;
        },
      ) => void;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-060-risk-integrity',
        '../../../../services/cmp-060-risk-integrity/src/index.ts',
      ),
    );
    const { options, resolveContext } = mounts.risk;
    // CMP-060 ContextResolver is header-based; adapt host FastifyRequest resolvers.
    mod.registerRiskRoutes(app, {
      ...options,
      resolveContext: async (headers) => resolveContext({ headers } as FastifyRequest),
    });
    mounted.push('CMP-060');
  }

  if (mounts.privacy) {
    await mountNeutralComponent(
      app,
      mounts.privacy,
      '@serviceform/cmp-061-privacy-centre',
      '../../../../services/cmp-061-privacy-centre/src/index.ts',
      'createPrivacyApi',
    );
    mounted.push('CMP-061');
  }

  return mounted;
}
