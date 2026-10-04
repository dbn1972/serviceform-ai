import {
  SESSION_COOKIE,
  apiBaseUrl,
  assertNoTenantIdentifyingHeaders,
  assertPlatformPath,
  cookieValue,
  encodeLocalSession,
  envIsProduction,
  errorJson,
  headersToRecord,
  parseLocalSession,
  sessionFromLogin,
  setCookie,
  type PortalSurface,
} from './bff';

function caught(err: unknown, fallback = '00000000-0000-4000-8000-000000000050'): Response {
  const e = err as { code?: string; status?: number };
  return errorJson(e.code ?? 'SF-SYS-001', e.status ?? 500, fallback);
}

export function handleCreateSession(request: Request, surface: PortalSurface): Promise<Response> {
  return (async () => {
    try {
      if (envIsProduction()) {
        return errorJson('SF-SYS-003', 400, '00000000-0000-4000-8000-000000000050');
      }
      assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
      const body = (await request.json()) as Record<string, unknown>;
      const session = sessionFromLogin(body, surface);
      const token = encodeLocalSession(session);
      return new Response(
        JSON.stringify({
          ...session,
          simulation: {
            simulation: true,
            scenario: 'studio_session',
            test_run_id: 'cmp050-local',
            connector_binding_id: '05005005-0050-4050-8050-050050050050',
            environment: 'LOCAL',
          },
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
            'set-cookie': setCookie(token, 28800),
          },
        },
      );
    } catch (err) {
      return caught(err);
    }
  })();
}

export function handleReadSession(request: Request, surfaces: PortalSurface[]): Response {
  try {
    assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
    const session = parseLocalSession(
      cookieValue(request.headers.get('cookie') ?? undefined, SESSION_COOKIE),
    );
    if (!surfaces.includes(session.surface)) {
      return errorJson('SF-AUTH-002', 403, session.correlation_id);
    }
    return Response.json(session);
  } catch (err) {
    return caught(err);
  }
}

export function handleClearSession(): Response {
  return new Response(null, { status: 204, headers: { 'set-cookie': setCookie('', 0) } });
}

export async function handlePlatformProxy(
  request: Request,
  pathParts: string[],
  surfaces: PortalSurface[],
): Promise<Response> {
  try {
    assertNoTenantIdentifyingHeaders(headersToRecord(request.headers));
    const session = parseLocalSession(
      cookieValue(request.headers.get('cookie') ?? undefined, SESSION_COOKIE),
    );
    if (!surfaces.includes(session.surface)) {
      return errorJson('SF-AUTH-002', 403, session.correlation_id);
    }
    const path = assertPlatformPath(pathParts.join('/'));
    const base = apiBaseUrl();
    if (!base) return errorJson('SF-SYS-004', 503, session.correlation_id);
    const headers: Record<string, string> = { accept: 'application/json' };
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
