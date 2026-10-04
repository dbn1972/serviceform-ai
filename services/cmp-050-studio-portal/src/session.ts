import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DeploymentEnvironment } from '../../../packages/contracts/src/index.js';
import { Cmp050Error } from './errors.js';

export const SESSION_COOKIE = 'sf_portal_session';

export type PortalSurface = 'service_studio' | 'tenant_admin' | 'platform_ops';

export type PortalSession = {
  tenant_id: string;
  actor_id: string;
  actor_type: 'OFFICER';
  roles: readonly string[];
  cell_id: string;
  correlation_id: string;
  surface: PortalSurface;
};

const SURFACES = new Set<PortalSurface>(['service_studio', 'tenant_admin', 'platform_ops']);

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

export function assertResourceTenant(session: PortalSession, resourceTenantId: string): void {
  if (session.tenant_id !== resourceTenantId) throw new Cmp050Error('SF-TEN-002');
}

export type LoginInput = {
  tenant_id: unknown;
  actor_id: unknown;
  roles: unknown;
  surface: PortalSurface;
  cell_id?: unknown;
};

export function sessionFromLogin(input: LoginInput): PortalSession {
  if (typeof input.tenant_id !== 'string' || !isUuid(input.tenant_id)) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'INVALID_TENANT_ID' }] });
  }
  if (typeof input.actor_id !== 'string' || !isUuid(input.actor_id)) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'INVALID_ACTOR_ID' }] });
  }
  if (!Array.isArray(input.roles) || input.roles.length < 1) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'INVALID_ROLES' }] });
  }
  const roles: string[] = [];
  for (const role of input.roles) {
    if (typeof role !== 'string' || !isRoleCode(role)) {
      throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'INVALID_ROLES' }] });
    }
    roles.push(role);
  }
  const cellId =
    typeof input.cell_id === 'string' && input.cell_id.length > 0 ? input.cell_id : 'cell-local';
  return {
    tenant_id: input.tenant_id,
    actor_id: input.actor_id,
    actor_type: 'OFFICER',
    roles,
    cell_id: cellId,
    correlation_id: randomUUID(),
    surface: input.surface,
  };
}

function payloadBytes(session: PortalSession): Buffer {
  return Buffer.from(
    JSON.stringify({
      tenant_id: session.tenant_id,
      actor_id: session.actor_id,
      actor_type: session.actor_type,
      roles: session.roles,
      cell_id: session.cell_id,
      correlation_id: session.correlation_id,
      surface: session.surface,
    }),
    'utf8',
  );
}

export function encodeSessionToken(
  session: PortalSession,
  opts: { environment: DeploymentEnvironment; secret?: string },
): string {
  if (!SURFACES.has(session.surface)) throw new Cmp050Error('SF-SYS-003');
  const body = payloadBytes(session).toString('base64url');
  if (opts.environment === 'PRODUCTION') {
    if (!opts.secret || opts.secret.length < 16) {
      throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'SESSION_SECRET_REQUIRED' }] });
    }
    const mac = createHmac('sha256', opts.secret).update(body).digest('base64url');
    return `v1.${body}.${mac}`;
  }
  return `v1.${body}.local`;
}

export function parseSessionToken(
  token: string | undefined,
  opts: { environment: DeploymentEnvironment; secret?: string },
): PortalSession {
  if (!token) throw new Cmp050Error('SF-AUTH-001');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) {
    throw new Cmp050Error('SF-AUTH-001');
  }
  const body = parts[1];
  const mac = parts[2];
  if (opts.environment === 'PRODUCTION') {
    if (!opts.secret || opts.secret.length < 16) {
      throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'SESSION_SECRET_REQUIRED' }] });
    }
    const expected = createHmac('sha256', opts.secret).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Cmp050Error('SF-AUTH-001');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Cmp050Error('SF-AUTH-001');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Cmp050Error('SF-AUTH-001');
  const rec = parsed as Record<string, unknown>;
  if (rec['actor_type'] !== 'OFFICER') throw new Cmp050Error('SF-AUTH-001');
  if (typeof rec['surface'] !== 'string' || !SURFACES.has(rec['surface'] as PortalSurface)) {
    throw new Cmp050Error('SF-AUTH-001');
  }
  const session = sessionFromLogin({
    tenant_id: rec['tenant_id'],
    actor_id: rec['actor_id'],
    roles: rec['roles'],
    surface: rec['surface'] as PortalSurface,
    cell_id: rec['cell_id'],
  });
  if (typeof rec['correlation_id'] === 'string' && isUuid(rec['correlation_id'])) {
    return { ...session, correlation_id: rec['correlation_id'] };
  }
  return session;
}

export function cookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=28800',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
