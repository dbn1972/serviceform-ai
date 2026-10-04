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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SURFACES = new Set<PortalSurface>(['service_studio', 'tenant_admin', 'platform_ops']);

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
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
    if (typeof role !== 'string' || !ROLE_RE.test(role)) {
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
