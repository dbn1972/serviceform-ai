import { Cmp050Error, errorBody } from './errors.js';
import { assertNoTenantIdentifyingHeaders } from './headers.js';
import {
  assertSimulatedSessionAllowed,
  buildPortalSimulationMarker,
  type PortalConfig,
} from './config.js';
import {
  SESSION_COOKIE,
  cookieHeader,
  encodeSessionToken,
  parseSessionToken,
  sessionFromLogin,
  type PortalSession,
  type PortalSurface,
} from './session.js';
import { assertPlatformPath, createHttpTransport } from './proxy.js';

export function correlationOf(session: PortalSession | undefined): string {
  return session?.correlation_id ?? '00000000-0000-4000-8000-000000000050';
}

export function jsonError(err: Cmp050Error, correlationId: string, status = err.statusCode) {
  return { status, body: errorBody(correlationId, err) };
}

export function createSessionResponse(input: {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  surface: PortalSurface;
  config: PortalConfig;
  secureCookie: boolean;
}): { status: number; body: unknown; setCookie?: string } {
  try {
    assertNoTenantIdentifyingHeaders(input.headers);
    assertSimulatedSessionAllowed(input.config.environment);
    if (typeof input.body !== 'object' || input.body === null) throw new Cmp050Error('SF-SYS-003');
    const rec = input.body as Record<string, unknown>;
    const session = sessionFromLogin({
      tenant_id: rec['tenant_id'],
      actor_id: rec['actor_id'],
      roles: rec['roles'],
      surface: input.surface,
      cell_id: rec['cell_id'],
    });
    const tokenOpts =
      input.config.sessionSecret === undefined
        ? { environment: input.config.environment }
        : { environment: input.config.environment, secret: input.config.sessionSecret };
    const token = encodeSessionToken(session, tokenOpts);
    const marker = buildPortalSimulationMarker({
      environment: input.config.environment,
      scenario: input.config.scenario,
      testRunId: input.config.testRunId,
      bindingId: input.config.bindingId,
    });
    return {
      status: 201,
      body: { ...session, simulation: marker },
      setCookie: cookieHeader(token, input.secureCookie),
    };
  } catch (err) {
    if (err instanceof Cmp050Error) return jsonError(err, correlationOf(undefined));
    throw err;
  }
}

export function readSessionResponse(input: {
  headers: Record<string, string | string[] | undefined>;
  cookieHeader: string | undefined;
  expectedSurface: PortalSurface | PortalSurface[];
  config: PortalConfig;
}): { status: number; body: unknown } {
  try {
    assertNoTenantIdentifyingHeaders(input.headers);
    const token = cookieValue(input.cookieHeader, SESSION_COOKIE);
    const tokenOpts =
      input.config.sessionSecret === undefined
        ? { environment: input.config.environment }
        : { environment: input.config.environment, secret: input.config.sessionSecret };
    const session = parseSessionToken(token, tokenOpts);
    const allowed = Array.isArray(input.expectedSurface)
      ? input.expectedSurface
      : [input.expectedSurface];
    if (!allowed.includes(session.surface)) throw new Cmp050Error('SF-AUTH-002');
    return { status: 200, body: session };
  } catch (err) {
    if (err instanceof Cmp050Error) return jsonError(err, correlationOf(undefined));
    throw err;
  }
}

export function clearSessionResponse(secureCookie: boolean): { status: number; setCookie: string } {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookie) parts.push('Secure');
  return { status: 204, setCookie: parts.join('; ') };
}

export async function proxyPlatformResponse(input: {
  headers: Record<string, string | string[] | undefined>;
  cookieHeader: string | undefined;
  method: 'GET' | 'POST' | 'PATCH';
  pathParts: string[];
  body: unknown;
  expectedSurface: PortalSurface | PortalSurface[];
  config: PortalConfig;
  fetchImpl: typeof fetch;
}): Promise<{ status: number; body: unknown }> {
  try {
    assertNoTenantIdentifyingHeaders(input.headers);
    const token = cookieValue(input.cookieHeader, SESSION_COOKIE);
    const tokenOpts =
      input.config.sessionSecret === undefined
        ? { environment: input.config.environment }
        : { environment: input.config.environment, secret: input.config.sessionSecret };
    const session = parseSessionToken(token, tokenOpts);
    const allowed = Array.isArray(input.expectedSurface)
      ? input.expectedSurface
      : [input.expectedSurface];
    if (!allowed.includes(session.surface)) throw new Cmp050Error('SF-AUTH-002');
    const path = assertPlatformPath(input.pathParts.join('/'));
    const transport = createHttpTransport(input.config.apiBaseUrl, input.fetchImpl);
    const idemRaw = headerValue(input.headers, 'idempotency-key');
    const req =
      idemRaw === undefined
        ? {
            method: input.method,
            path,
            ...(input.method === 'GET' ? {} : { body: input.body ?? {} }),
          }
        : {
            method: input.method,
            path,
            ...(input.method === 'GET' ? {} : { body: input.body ?? {} }),
            idempotencyKey: idemRaw,
          };
    return await transport.send(req);
  } catch (err) {
    if (err instanceof Cmp050Error) return jsonError(err, correlationOf(undefined));
    throw err;
  }
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
