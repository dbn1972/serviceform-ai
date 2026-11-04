import { randomUUID } from 'node:crypto';

/**
 * Officer workbench BFF → platform (SF-CON-PORTAL-SESSION, ADR-0007 D-3). Server-only.
 * The cookie holds only the CMP-004 opaque officer session token; identity, tenant and roles are
 * re-derived from CMP-004 per request. Client headers are never forwarded.
 */
export const SESSION_COOKIE = 'sf_officer_session';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function apiBase(): string {
  const base = (process.env['SF_API_BASE_URL'] ?? '').replace(/\/$/, '');
  if (!base) throw new Error('SF_API_BASE_URL is not configured');
  return base;
}

/** SIMULATED IdP sign-in is only offered in LOCAL/CI. */
export function simulationAllowed(): boolean {
  return ['LOCAL', 'CI'].includes(process.env['SF_ENVIRONMENT'] ?? 'LOCAL');
}

export function sessionToken(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0 && trimmed.slice(0, eq) === SESSION_COOKIE) {
      const raw = trimmed.slice(eq + 1);
      return TOKEN_RE.test(raw) ? raw : null;
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAge: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === 'production' || process.env['SF_COOKIE_SECURE'] === '1') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export interface PlatformResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function platform(
  method: 'GET' | 'POST',
  path: string,
  opts: { token?: string | null; body?: unknown; idempotent?: boolean } = {},
): Promise<PlatformResponse> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': randomUUID(),
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.idempotent) headers['idempotency-key'] = `workbench-${randomUUID()}`;
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      redirect: 'error',
      cache: 'no-store',
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: body && typeof body === 'object' ? body : {} };
  } catch {
    return {
      status: 503,
      body: { error_code: 'SF-SYS-004', message: 'Service temporarily unavailable' },
    };
  }
}

export interface Officer {
  token: string;
  officer_id: string;
}

/** CMP-004 `GET /v1/identity/me`; only an active OFFICER session counts. */
export async function currentOfficer(request: Request): Promise<Officer | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const me = await platform('GET', '/v1/identity/me', { token });
  if (me.status !== 200 || me.body['actor_type'] !== 'OFFICER' || !isUuid(me.body['subject_id'])) {
    return null;
  }
  return { token, officer_id: me.body['subject_id'] };
}

export function json(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function relay(res: PlatformResponse): Response {
  const code = typeof res.body['error_code'] === 'string' ? res.body['error_code'] : 'SF-SYS-001';
  const message = typeof res.body['message'] === 'string' ? res.body['message'] : 'Request denied';
  const status = res.status >= 400 && res.status < 600 ? res.status : 502;
  return json(status, { error_code: code, message });
}
