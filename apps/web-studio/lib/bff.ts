/**
 * SF-M10-B-4: Studio BFF helpers — ADR-0007 aligned. The session cookie holds only the CMP-004
 * opaque officer session token (minted via the SIMULATED studio-auth endpoint). No session claims
 * are stored in the cookie; identity, tenant and roles are re-derived from CMP-004 per request.
 * LOCAL/CI only: session creation is refused in production (simulationAllowed guard).
 */
const FORBIDDEN = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

/** Matches the CMP-004 opaque session token format (base64url, 32–128 chars). */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

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

/** Extract and validate a CMP-004 opaque session token from the request cookie. */
export function bearerToken(request: Request): string | null {
  const raw = cookieValue(request.headers.get('cookie') ?? undefined, SESSION_COOKIE);
  if (!raw || !TOKEN_RE.test(raw)) return null;
  return raw;
}

export function envIsProduction(): boolean {
  return process.env['SF_ENVIRONMENT'] === 'PRODUCTION';
}

/** SIMULATED studio-auth is only offered in LOCAL/CI. */
export function simulationAllowed(): boolean {
  return ['LOCAL', 'CI'].includes(process.env['SF_ENVIRONMENT'] ?? 'LOCAL');
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
