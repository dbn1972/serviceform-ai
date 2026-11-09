/**
 * SF-M10-B-4: Studio BFF handlers — CMP-004 opaque session, bearer forwarding (ADR-0007 D-3).
 * Session cookie holds only the opaque CMP-004 token (minted via SIMULATED studio-auth endpoint).
 * All platform proxy calls forward Authorization: Bearer <token> so CMP-004 resolves context.
 * Session creation refused in production (simulationAllowed guard).
 */
import {
  SESSION_COOKIE,
  apiBaseUrl,
  assertNoTenantIdentifyingHeaders,
  assertPlatformPath,
  bearerToken,
  envIsProduction,
  errorJson,
  headersToRecord,
  isRoleCode,
  isUuid,
  setCookie,
  simulationAllowed,
  type PortalSurface,
} from './bff';

const FALLBACK_CID = '00000000-0000-4000-8000-000000000050';
const SESSION_MAX_AGE = 28800;

function caught(err: unknown, fallback = FALLBACK_CID): Response {
  const e = err as { code?: string; status?: number };
  return errorJson(e.code ?? 'SF-SYS-001', e.status ?? 500, fallback);
}

/**
 * Creates a CMP-004 officer session for the given studio/admin actor via the SIMULATED
 * studio-auth endpoint. The session cookie is set with the returned opaque token only.
 * Refused in production. Accepts the same { tenant_id, actor_id, roles } body as before
 * so the existing SessionForm.tsx UI does not require changes.
 */
export function handleCreateSession(request: Request, surface: PortalSurface): Promise<Response> {
  return (async () => {
    try {
      if (envIsProduction()) {
        return errorJson('SF-SYS-003', 400, FALLBACK_CID);
      }
      if (!simulationAllowed()) {
        return errorJson('SF-SYS-003', 400, FALLBACK_CID);
      }
      assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
      const body = (await request.json()) as Record<string, unknown>;

      // Validate body shape (tenant header isolation: validate before any API call)
      if (typeof body['tenant_id'] !== 'string' || !isUuid(body['tenant_id'])) {
        throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
      }
      if (typeof body['actor_id'] !== 'string' || !isUuid(body['actor_id'])) {
        throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
      }
      if (!Array.isArray(body['roles']) || body['roles'].length < 1) {
        throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
      }
      const roles = body['roles'].map((role) => {
        if (typeof role !== 'string' || !isRoleCode(role)) {
          throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
        }
        return role;
      });

      // Exchange with the SIMULATED studio-auth endpoint → CMP-004 opaque token
      const base = apiBaseUrl();
      if (!base) return errorJson('SF-SYS-004', 503, FALLBACK_CID);

      const authRes = await fetch(`${base}/v1/simulated/studio-auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ tenant_id: body['tenant_id'], actor_id: body['actor_id'], roles }),
      });
      const authBody = (await authRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!authRes.ok || typeof authBody['session_token'] !== 'string') {
        const code = typeof authBody['error_code'] === 'string' ? authBody['error_code'] : 'SF-SYS-004';
        return errorJson(code, authRes.status >= 400 ? authRes.status : 503, FALLBACK_CID);
      }
      const token = authBody['session_token'];

      return new Response(
        JSON.stringify({
          tenant_id: body['tenant_id'],
          actor_id: body['actor_id'],
          actor_type: 'OFFICER',
          roles,
          surface,
          simulation: { simulation: true, scenario: 'studio_session', g6_issued: false },
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

/**
 * Reads the current session by validating the CMP-004 token with GET /v1/identity/me.
 * Returns 401 if the token is absent or invalid; 403 if the actor is not an OFFICER.
 */
export async function handleReadSession(
  request: Request,
  _surfaces: PortalSurface[],
): Promise<Response> {
  try {
    assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
    const token = bearerToken(request);
    if (!token) return errorJson('SF-AUTH-001', 401, FALLBACK_CID);

    const base = apiBaseUrl();
    if (!base) return errorJson('SF-SYS-004', 503, FALLBACK_CID);

    const meRes = await fetch(`${base}/v1/identity/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!meRes.ok) return errorJson('SF-AUTH-001', meRes.status === 401 ? 401 : 403, FALLBACK_CID);
    const me = (await meRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (me['actor_type'] !== 'OFFICER') {
      return errorJson('SF-AUTH-002', 403, FALLBACK_CID);
    }
    return Response.json(me);
  } catch (err) {
    return caught(err);
  }
}

export function handleClearSession(): Response {
  return new Response(null, { status: 204, headers: { 'set-cookie': setCookie('', 0) } });
}

/**
 * Proxies platform API calls; forwards the CMP-004 bearer token so the host's
 * placementContextResolver can resolve identity, tenant and roles (ADR-0007 D-3).
 */
export async function handlePlatformProxy(
  request: Request,
  pathParts: string[],
  _surfaces: PortalSurface[],
): Promise<Response> {
  try {
    assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
    const token = bearerToken(request);
    if (!token) return errorJson('SF-AUTH-001', 401, FALLBACK_CID);

    const path = assertPlatformPath(pathParts.join('/'));
    const base = apiBaseUrl();
    if (!base) return errorJson('SF-SYS-004', 503, FALLBACK_CID);

    // Forward bearer token for CMP-004 context resolution (ADR-0007 D-3)
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
