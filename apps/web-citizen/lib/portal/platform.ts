import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Citizen portal BFF → platform (SF-CON-PORTAL-SESSION, ADR-0007 D-3). Server-only.
 * The browser cookie holds only the CMP-004 opaque session token; identity is re-derived from
 * CMP-004 on every request and the token is forwarded as a bearer credential. Client headers are
 * never forwarded, and every platform path is composed here from fixed templates.
 */
export const SESSION_COOKIE = 'sf_citizen_session';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function apiBase(): string {
  const base = (process.env['SF_API_BASE_URL'] ?? '').replace(/\/$/, '');
  if (!base) throw new Error('SF_API_BASE_URL is not configured');
  return base;
}

export function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

export function sessionToken(request: Request): string | null {
  const raw = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
  return raw && TOKEN_RE.test(raw) ? raw : null;
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

export function clearSessionCookie(): string {
  return sessionCookie('', 0);
}

export interface PlatformResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function platform(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: {
    token?: string | null;
    body?: unknown;
    idempotent?: boolean;
    idempotencyKey?: string;
  } = {},
): Promise<PlatformResponse> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': randomUUID(),
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  else if (opts.idempotent) headers['idempotency-key'] = `portal-${randomUUID()}`;
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      redirect: 'error',
      cache: 'no-store',
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch {
    return {
      status: 503,
      body: { error_code: 'SF-SYS-004', message: 'Service temporarily unavailable' },
    };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: body && typeof body === 'object' ? body : {} };
}

export interface Citizen {
  token: string;
  citizen_id: string;
  assurance: string;
}

/** CMP-004 `GET /v1/identity/me`; only an active CITIZEN session counts. */
export async function currentCitizen(request: Request): Promise<Citizen | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const me = await platform('GET', '/v1/identity/me', { token });
  if (me.status !== 200 || me.body['actor_type'] !== 'CITIZEN' || !isUuid(me.body['subject_id'])) {
    return null;
  }
  return { token, citizen_id: me.body['subject_id'], assurance: String(me.body['assurance']) };
}

export interface PortalOffering {
  catalogue_id: string;
  tenant_service_binding_id: string;
}

interface PlacementFile {
  environment: string;
  environment_label?: string;
  offerings: PortalOffering[];
}

let placement: PlacementFile | null = null;

/** Deployment placement (SF-CON-PORTAL-PLACEMENT). The tenant itself is applied by the API host. */
export function portalPlacement(): PlacementFile {
  if (placement) return placement;
  const file = process.env['SF_PORTAL_PLACEMENT_FILE'];
  if (!file) throw new Error('SF_PORTAL_PLACEMENT_FILE is not configured');
  placement = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, 'utf8')) as PlacementFile;
  return placement;
}

export function offeringFor(catalogueId: string): PortalOffering | null {
  return portalPlacement().offerings.find((o) => o.catalogue_id === catalogueId) ?? null;
}

/** SIMULATED connectors (OTP inbox) are only consulted in LOCAL/CI placements. */
export function simulationAllowed(): boolean {
  return ['LOCAL', 'CI'].includes(portalPlacement().environment);
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

export function relay(res: PlatformResponse, fallbackMessage = 'Request denied'): Response {
  const code = typeof res.body['error_code'] === 'string' ? res.body['error_code'] : 'SF-SYS-001';
  const message = typeof res.body['message'] === 'string' ? res.body['message'] : fallbackMessage;
  const status = res.status >= 400 && res.status < 600 ? res.status : 502;
  return json(status, { error_code: code, message });
}
