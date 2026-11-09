/**
 * SF-M10-B-4: Studio BFF handlers — CMP-004 SIMULATED officer sessions.
 * Session cookie holds an opaque CMP-004 bearer token (never PII/claims).
 * `handlePlatformProxy` forwards Authorization: Bearer per ADR-0007 D-3.
 */
import {
  SESSION_COOKIE,
  apiBaseUrl,
  assertNoTenantIdentifyingHeaders,
  assertPlatformPath,
  cmp004Token,
  errorJson,
  headersToRecord,
  platform,
  setCookie,
  simulationAllowed,
  type PortalSurface,
} from './bff';

const SESSION_MAX_AGE = 8 * 60 * 60;

function caught(err: unknown, fallback = '00000000-0000-4000-8000-000000000050'): Response {
  const e = err as { code?: string; status?: number };
  return errorJson(e.code ?? 'SF-SYS-001', e.status ?? 500, fallback);
}

/**
 * SIMULATED IdP assertion → CMP-004 `issueOfficerSession`.
 * Accepts `{ subject: string }` — the officer's sub identifier from officers.json.
 * Guarded to LOCAL/CI; returns 404 in production.
 */
export function handleCreateSession(request: Request, _surface: PortalSurface): Promise<Response> {
  return (async () => {
    try {
      assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
      if (!simulationAllowed()) {
        return errorJson('SF-SYS-003', 400, '00000000-0000-4000-8000-000000000050');
      }
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body['subject'] !== 'string' || body['subject'].length < 1 || body['subject'].length > 80) {
        return errorJson('SF-SYS-003', 400, '00000000-0000-4000-8000-000000000050');
      }
      if (!apiBaseUrl()) {
        return errorJson('SF-SYS-004', 503, '00000000-0000-4000-8000-000000000050');
      }
      const assertion = await platform('POST', '/v1/simulated/idp/assertions', {
        body: { subject: body['subject'] },
      });
      if (assertion.status !== 200 || typeof assertion.body['assertion'] !== 'string') {
        const code = typeof assertion.body['error_code'] === 'string' ? assertion.body['error_code'] : 'SF-AUTH-001';
        return errorJson(code, assertion.status >= 400 && assertion.status < 600 ? assertion.status : 502, '00000000-0000-4000-8000-000000000050');
      }
      const session = await platform('POST', '/v1/identity/officer/sessions', {
        body: { assertion: assertion.body['assertion'] },
      });
      const token = session.body['session_token'];
      if (session.status !== 200 || typeof token !== 'string') {
        const code = typeof session.body['error_code'] === 'string' ? session.body['error_code'] : 'SF-AUTH-001';
        return errorJson(code, session.status >= 400 && session.status < 600 ? session.status : 502, '00000000-0000-4000-8000-000000000050');
      }
      return new Response(
        JSON.stringify({
          authenticated: true,
          display_name: assertion.body['display_name'] ?? 'Studio officer',
          simulation: true,
          g6_issued: false,
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
            'set-cookie': setCookie(token, SESSION_MAX_AGE),
          },
        },
      );
    } catch (err) {
      return caught(err);
    }
  })();
}

/** Returns studio session state via CMP-004 `GET /v1/identity/me`. */
export function handleReadSession(request: Request, _surfaces: PortalSurface[]): Response {
  const run = async () => {
    try {
      assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
      const token = cmp004Token(request);
      if (!token) return errorJson('SF-AUTH-001', 401, '00000000-0000-4000-8000-000000000050');
      const me = await platform('GET', '/v1/identity/me', { token });
      if (me.status !== 200 || me.body['actor_type'] !== 'OFFICER') {
        return errorJson('SF-AUTH-001', 401, '00000000-0000-4000-8000-000000000050');
      }
      return Response.json({ authenticated: true, simulation: true, g6_issued: false });
    } catch (err) {
      return caught(err);
    }
  };
  return run() as unknown as Response;
}

export function handleClearSession(): Response {
  return new Response(null, { status: 204, headers: { 'set-cookie': setCookie('', 0) } });
}

/**
 * Proxies allowlisted platform API calls with CMP-004 bearer forwarded.
 * Enforces SF-TEN-002 (no tenant-identifying headers from client),
 * SF-AUTH-002 (path allowlist), INT-013 (SIMULATED only in LOCAL/CI).
 */
export async function handlePlatformProxy(
  request: Request,
  pathParts: string[],
  _surfaces: PortalSurface[],
): Promise<Response> {
  try {
    assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
    const token = cmp004Token(request);
    if (!token) return errorJson('SF-AUTH-001', 401, '00000000-0000-4000-8000-000000000050');
    const path = assertPlatformPath(pathParts.join('/'));
    const base = apiBaseUrl();
    if (!base) return errorJson('SF-SYS-004', 503, '00000000-0000-4000-8000-000000000050');
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    };
    const idem = request.headers.get('idempotency-key');
    if (idem) headers['Idempotency-Key'] = idem;
    const method = request.method.toUpperCase();
    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      headers['content-type'] = 'application/json';
      body = await request.text();
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return caught(err);
  }
}

/** Returns the session cookie name for tests. */
export { SESSION_COOKIE };
