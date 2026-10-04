const FORBIDDEN = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

/** Linear UUID shape check — avoids quantifier regexes (njsscan regex_dos). */
export function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  const parts = value.split('-');
  if (parts.length !== 5) return false;
  const lengths = [8, 4, 4, 4, 12] as const;
  for (let i = 0; i < 5; i += 1) {
    const part = parts[i];
    if (!part || part.length !== lengths[i]) return false;
    for (let j = 0; j < part.length; j += 1) {
      const c = part.charCodeAt(j);
      const isDigit = c >= 48 && c <= 57;
      const isLower = c >= 97 && c <= 102;
      const isUpper = c >= 65 && c <= 70;
      if (!isDigit && !isLower && !isUpper) return false;
    }
  }
  return true;
}

/** Linear role-code check (A-Z then 1–63 of A-Z0-9_). */
export function isRoleCode(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  const first = value.charCodeAt(0);
  if (first < 65 || first > 90) return false;
  for (let i = 1; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isUpper = c >= 65 && c <= 90;
    if (!isDigit && !isUpper && c !== 95) return false;
  }
  return true;
}

function forwardedDeclaresTenant(value: string): boolean {
  const lower = value.toLowerCase();
  for (let i = 0; i < lower.length; i += 1) {
    if (!lower.startsWith('tenant', i)) continue;
    if (i > 0) {
      const prev = lower.charCodeAt(i - 1);
      if (prev !== 59 && prev !== 32 && prev !== 9 && prev !== 13 && prev !== 10) continue;
    }
    let j = i + 6;
    while (j < lower.length && (lower.charCodeAt(j) === 32 || lower.charCodeAt(j) === 9)) j += 1;
    if (j < lower.length && lower[j] === '=') return true;
  }
  return false;
}

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
    if (name.toLowerCase() === 'forwarded' && forwardedDeclaresTenant(value)) {
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
  if (!isUuid(parsed.tenant_id) || !isUuid(parsed.actor_id) || parsed.actor_type !== 'OFFICER') {
    throw Object.assign(new Error('SF-AUTH-001'), { code: 'SF-AUTH-001', status: 401 });
  }
  return parsed;
}

export function sessionFromLogin(
  body: Record<string, unknown>,
  surface: PortalSurface,
): PortalSession {
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
  let i = 0;
  while (i < path.length && path[i] === '/') i += 1;
  const trimmed = path.slice(i);
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
