import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { sanitizeRequestForLog } from '@serviceform/observability';

/**
 * Optional M07 mounts: CMP-022 credential engine, CMP-024 credential registry,
 * CMP-023 QR verification, CMP-012 DigiLocker publish.
 *
 * Every M07 component publishes a transport-neutral `create*Api` / `.handle` plus
 * `ROUTE_DESCRIPTORS` whose paths already carry the `/v1` prefix, so no extra prefix is
 * applied here.
 *
 * Connector posture for host composition tests / CI wiring:
 * - CMP-022 signing/render ports → supplied by the caller (REAL HSM/KMS signer deferred)
 * - CMP-023 credential port → supplied by the caller (reads CMP-022 via published port only)
 * - CMP-012 DigiLocker → SimulatedDigiLockerConnector (REAL DigiLocker deferred; never PROD)
 *
 * Same structural rules as M02–M06/M08: non-literal dynamic import so the host does not
 * merge sibling Fastify module-augmentation graphs into this TypeScript program.
 *
 * Package specifiers are preferred (stitch admitted workspace importers). File URLs are a
 * pre-lockfile fallback so host tests can load components without writing pnpm-lock.yaml
 * or apps/api/package.json in this envelope.
 *
 * Host composition adapts transport only. No domain logic, no cross-component SQL, and the
 * host is never the credential issuance/status/verification authority.
 *
 * CMP-036 API Gateway is already registered on the host in app.ts — do not remount it here.
 * M05/M06/M08 mounts are left untouched.
 */
export interface M07PluginMounts {
  /** CMP-022 Credential Engine. Transport-neutral `createCredentialApi` / `.handle`. */
  credential?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-024 Credential Registry. Transport-neutral `createRegistryApi` / `.handle`. */
  registry?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /** CMP-023 QR Verification. Transport-neutral `createQrApi` / `.handle`. */
  qr?: {
    service: unknown;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  };
  /**
   * CMP-012 DigiLocker. Transport-neutral `createDigilockerApi` / `.handle`.
   * Host wiring uses the SIMULATED connector only; REAL DigiLocker is deferred.
   */
  digilocker?: {
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

/**
 * Route-scoped `req` log serializer: the CMP-047 path-only sanitisation, then every path
 * segment bound to a component-declared bearer parameter is replaced by its `:param`
 * template segment. Applies to Fastify's `incoming request` line and to CMP-047's
 * `request completed` line, both of which log through the route's child logger.
 */
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
 * Registers M07 Fastify mounts under Eng v1.4 `/v1` paths.
 * Call only from the API host — services must not import each other (no cross-component SQL).
 * Mount order: CMP-022, CMP-024, CMP-023, CMP-012.
 * CMP-036 is not remounted.
 */
export async function registerM07Plugins(
  app: FastifyInstance,
  mounts: M07PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.credential) {
    await mountNeutralComponent(
      app,
      mounts.credential,
      '@serviceform/cmp-022-credential-engine',
      '../../../../services/cmp-022-credential-engine/src/index.ts',
      'createCredentialApi',
    );
    mounted.push('CMP-022');
  }

  if (mounts.registry) {
    await mountNeutralComponent(
      app,
      mounts.registry,
      '@serviceform/cmp-024-credential-registry',
      '../../../../services/cmp-024-credential-registry/src/index.ts',
      'createRegistryApi',
    );
    mounted.push('CMP-024');
  }

  if (mounts.qr) {
    await mountNeutralComponent(
      app,
      mounts.qr,
      '@serviceform/cmp-023-qr-verification',
      '../../../../services/cmp-023-qr-verification/src/index.ts',
      'createQrApi',
    );
    mounted.push('CMP-023');
  }

  if (mounts.digilocker) {
    await mountNeutralComponent(
      app,
      mounts.digilocker,
      '@serviceform/cmp-012-digilocker',
      '../../../../services/cmp-012-digilocker/src/index.ts',
      'createDigilockerApi',
    );
    mounted.push('CMP-012');
  }

  return mounted;
}
