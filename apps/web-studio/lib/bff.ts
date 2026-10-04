const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const FORBIDDEN = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

export const SESSION_COOKIE = 'sf_portal_session';

export type PortalSurface = 'service_studio' | 'tenant_admin' | 'platform_ops';

export type PortalSession = {
  tenant_id: string;
  actor_id: string;
  actor_type: 'OFFICER';
  roles: string[];
  cell_id: string;
  correlation_id: string;
  surface: PortalSurface;
};

export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('tenant') || n.startsWith('x-sf-') || FORBIDDEN.has(n);
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function assertNoTenantIdentifyingHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (isForbiddenHeaderName(name)) {
      throw Object.assign(new Error('SF-TEN-002'), { code: 'SF-TEN-002', status: 403 });
    }
    if (name.toLowerCase() === 'forwarded' && /(?:^|;|\s)tenant\s*=/i.test(value)) {
      throw Object.assign(new Error('SF-TEN-002'), { code: 'SF-TEN-002', status: 403 });
    }
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

function newId(): string {
  return crypto.randomUUID();
}

export function encodeLocalSession(session: PortalSession): string {
  const body = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `v1.${body}.local`;
}

export function parseLocalSession(token: string | undefined): PortalSession {
  if (!token) throw Object.assign(new Error('SF-AUTH-001'), { code: 'SF-AUTH-001', status: 401 });
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1]) {
    throw Object.assign(new Error('SF-AUTH-001'), { code: 'SF-AUTH-001', status: 401 });
  }
  const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as PortalSession;
  if (
    !UUID_RE.test(parsed.tenant_id) ||
    !UUID_RE.test(parsed.actor_id) ||
    parsed.actor_type !== 'OFFICER'
  ) {
    throw Object.assign(new Error('SF-AUTH-001'), { code: 'SF-AUTH-001', status: 401 });
  }
  return parsed;
}

export function sessionFromLogin(
  body: Record<string, unknown>,
  surface: PortalSurface,
): PortalSession {
  if (typeof body['tenant_id'] !== 'string' || !UUID_RE.test(body['tenant_id'])) {
    throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
  }
  if (typeof body['actor_id'] !== 'string' || !UUID_RE.test(body['actor_id'])) {
    throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
  }
  if (!Array.isArray(body['roles']) || body['roles'].length < 1) {
    throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
  }
  const roles = body['roles'].map((role) => {
    if (typeof role !== 'string' || !ROLE_RE.test(role)) {
      throw Object.assign(new Error('SF-SYS-003'), { code: 'SF-SYS-003', status: 400 });
    }
    return role;
  });
  return {
    tenant_id: body['tenant_id'],
    actor_id: body['actor_id'],
    actor_type: 'OFFICER',
    roles,
    cell_id:
      typeof body['cell_id'] === 'string' && body['cell_id'].length > 0
        ? body['cell_id']
        : 'cell-local',
    correlation_id: newId(),
    surface,
  };
}

export function envIsProduction(): boolean {
  return process.env['SF_ENVIRONMENT'] === 'PRODUCTION';
}

export function apiBaseUrl(): string {
  return (process.env['SF_API_BASE_URL'] ?? '').replace(/\/$/, '');
}

const ALLOWED_PREFIXES = [
  'metadata/',
  'publication-requests',
  'tenant-service-bindings',
  'artifact-versions/',
  'categories',
  'canonical-services',
  'offerings',
  'admin/categories',
  'admin/canonical-services',
];

export function assertPlatformPath(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  const relative = trimmed.startsWith('v1/') ? trimmed.slice(3) : trimmed;
  const ok = ALLOWED_PREFIXES.some(
    (prefix) => relative === prefix.replace(/\/$/, '') || relative.startsWith(prefix),
  );
  if (!ok || relative.includes('..')) {
    throw Object.assign(new Error('SF-AUTH-002'), { code: 'SF-AUTH-002', status: 403 });
  }
  return `/v1/${relative}`;
}

export function errorJson(code: string, status: number, correlationId: string): Response {
  return Response.json(
    { error_code: code, message: 'Request denied', correlation_id: correlationId },
    { status },
  );
}

export function setCookie(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
