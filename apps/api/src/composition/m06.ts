import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';

/**
 * Optional M06 mounts: CMP-020 fee, CMP-021 payment, CMP-025 notification,
 * CMP-026 communication/messaging.
 *
 * SIMULATED connectors only for host composition tests / CI wiring:
 * - CMP-021 Payment → SimulatedPspConnector (REAL HubPsp deferred)
 * - CMP-025 Notification → SimulatedChannelConnector SMS/EMAIL (REAL hub deferred)
 * - CMP-026 Messaging → simulated storage / case participation (channel fanout is CMP-025)
 *
 * Same structural rules as M02–M05: non-literal dynamic import so the host does not
 * merge sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Package specifiers are preferred (stitch admitted workspace importers). File URLs are a
 * pre-lockfile fallback so host tests can load plugins without writing pnpm-lock.yaml
 * or apps/api/package.json in this envelope.
 *
 * Host composition adapts transport only. No domain logic, no cross-component SQL, and the
 * host is not the fee/payment/notification authority.
 *
 * CMP-036 API Gateway is already registered on the host in app.ts — do not remount it here.
 * Hard serial vs SF-M08-007 (must_not_run_concurrent_with).
 */
export interface M06PluginMounts {
  /**
   * CMP-020 Fee Calculation. Transport-neutral `createFeeApi` / `.handle`.
   */
  fee?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /**
   * CMP-021 Payment. Transport-neutral `createPaymentApi` / `.handle`.
   * Host wiring uses SIMULATED PSP only; REAL HubPsp is deferred.
   */
  payment?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /**
   * CMP-025 Notification. Transport-neutral `createNotificationApi` / `.handle`.
   * Host wiring uses SIMULATED SMS/EMAIL channel connectors; REAL hub deferred.
   */
  notification?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /**
   * CMP-026 Communication / Messaging. Uses published `registerMessagingRoutes`
   * under `/v1` (component paths are relative: `/threads`, …).
   */
  messaging?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
    prefix?: string;
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

/**
 * Registers M06 Fastify mounts under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other (no cross-component SQL).
 * Mount order: CMP-020, CMP-021, CMP-025, CMP-026.
 * CMP-036 is not remounted.
 */
export async function registerM06Plugins(
  app: FastifyInstance,
  mounts: M06PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.fee) {
    const mod = await loadModule<{
      createFeeApi: (opts: {
        service: unknown;
        resolveContext: (
          headers: Readonly<Record<string, string | string[] | undefined>>,
        ) => Promise<RequestContext | null>;
      }) => { handle: NeutralHandler };
      ROUTE_DESCRIPTORS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-020-fee-calculation',
        '../../../../services/cmp-020-fee-calculation/src/index.ts',
      ),
    );
    const api = mod.createFeeApi({
      service: mounts.fee.service,
      resolveContext: bindResolveContextFromHeaders(mounts.fee.resolveContext),
    });
    await mountNeutralRoutes(app, mod.ROUTE_DESCRIPTORS, (req) => api.handle(req));
    mounted.push('CMP-020');
  }

  if (mounts.payment) {
    const mod = await loadModule<{
      createPaymentApi: (opts: {
        service: unknown;
        resolveContext: (
          headers: Readonly<Record<string, string | string[] | undefined>>,
        ) => Promise<RequestContext | null>;
      }) => { handle: NeutralHandler };
      ROUTE_DESCRIPTORS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-021-payment',
        '../../../../services/cmp-021-payment/src/index.ts',
      ),
    );
    const api = mod.createPaymentApi({
      service: mounts.payment.service,
      resolveContext: bindResolveContextFromHeaders(mounts.payment.resolveContext),
    });
    await mountNeutralRoutes(app, mod.ROUTE_DESCRIPTORS, (req) => api.handle(req));
    mounted.push('CMP-021');
  }

  if (mounts.notification) {
    const mod = await loadModule<{
      createNotificationApi: (opts: {
        service: unknown;
        resolveContext: (
          headers: Readonly<Record<string, string | string[] | undefined>>,
        ) => Promise<RequestContext | null>;
      }) => { handle: NeutralHandler };
      ROUTE_DESCRIPTORS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }>;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-025-notification',
        '../../../../services/cmp-025-notification/src/index.ts',
      ),
    );
    const api = mod.createNotificationApi({
      service: mounts.notification.service,
      resolveContext: bindResolveContextFromHeaders(mounts.notification.resolveContext),
    });
    await mountNeutralRoutes(app, mod.ROUTE_DESCRIPTORS, (req) => api.handle(req));
    mounted.push('CMP-025');
  }

  if (mounts.messaging) {
    const mod = await loadModule<{
      registerMessagingRoutes: (
        registrar: FastifyInstance,
        opts: {
          service: unknown;
          resolveContext: (request: unknown) => Promise<unknown>;
        },
      ) => void;
    }>(
      workspaceSpecifiers(
        '@serviceform/cmp-026-communication-messaging',
        '../../../../services/cmp-026-communication-messaging/src/index.ts',
      ),
    );
    const { service, resolveContext, prefix } = mounts.messaging;
    await app.register(
      async (scoped) => {
        mod.registerMessagingRoutes(scoped, {
          service,
          resolveContext: async (request) => resolveContext(request as FastifyRequest),
        });
      },
      { prefix: prefix ?? '/v1' },
    );
    mounted.push('CMP-026');
  }

  return mounted;
}
