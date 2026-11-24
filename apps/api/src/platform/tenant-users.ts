import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { LabOfficer } from './simulators.js';

/**
 * SAMPLE_LAB M02 identity admin surface — tenant workforce user directory.
 * Admin BFF contract shared by SIMULATED and Keycloak Admin REST adapters.
 * Never embeds Keycloak Admin Console. Never invents statute.
 * CERTIFIED=false · G6=false · ADR-0007 remains PROPOSED (not claimed accepted).
 * No DigiLocker / SMS / Payment REAL work. No PII in logs (user_id only).
 */

export type TenantUserAdapterMode = 'SIMULATED' | 'KEYCLOAK';

export interface TenantWorkforceUser {
  user_id: string;
  username: string;
  display_name: string;
  email: string | null;
  enabled: boolean;
  roles: string[];
  tenant_id: string;
}

export interface CreateTenantUserInput {
  username: string;
  display_name: string;
  email?: string | null;
  enabled?: boolean;
  roles?: string[];
}

export interface UpdateTenantUserInput {
  display_name?: string;
  email?: string | null;
  enabled?: boolean;
}

export interface TenantUserDirectory {
  readonly mode: TenantUserAdapterMode;
  readonly simulation: boolean;
  list(tenantId: string): Promise<TenantWorkforceUser[]>;
  get(tenantId: string, userId: string): Promise<TenantWorkforceUser | null>;
  create(tenantId: string, input: CreateTenantUserInput): Promise<TenantWorkforceUser>;
  update(
    tenantId: string,
    userId: string,
    input: UpdateTenantUserInput,
  ): Promise<TenantWorkforceUser>;
  assignRoles(tenantId: string, userId: string, roles: string[]): Promise<TenantWorkforceUser>;
  roleCatalogue(tenantId: string): Promise<string[]>;
}

export interface TenantUserAuthzPort {
  decide(input: unknown): Promise<{ allow?: unknown }>;
}

export interface TenantUserRequestContext {
  tenant_id: string | null;
  cell_id: string;
  actor: { type: string; id: string };
  roles: string[];
  jurisdiction_ids: string[];
  auth_assurance: string;
  correlation_id: string;
  trace_id: string;
}

const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_ROLE_CATALOGUE = [
  'TENANT_ADMIN_STUDIO',
  'STUDIO_DESIGNER',
  'STUDIO_CHECKER',
  'SAMPLE_LAB_CASE_OFFICER',
  'SAMPLE_LAB_SCRUTINY_OFFICER',
  'SAMPLE_LAB_APPROVING_AUTHORITY',
  'SAMPLE_LAB_HELPDESK_L1',
  'SAMPLE_LAB_INSPECTION_OFFICER',
  'SAMPLE_LAB_OPS_ANALYST',
] as const;

export class TenantUserDirectoryError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TenantUserDirectoryError';
  }
}

function assertRoleCodes(roles: string[]): string[] {
  const out: string[] = [];
  for (const role of roles) {
    if (typeof role !== 'string' || !ROLE_RE.test(role)) {
      throw new TenantUserDirectoryError('SF-SYS-003', 400, 'Invalid role code');
    }
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

function assertUsername(username: string): string {
  if (!USERNAME_RE.test(username)) {
    throw new TenantUserDirectoryError('SF-SYS-003', 400, 'Invalid username');
  }
  return username;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (email === undefined || email === null || email === '') return null;
  if (typeof email !== 'string' || email.length > 254 || !email.includes('@')) {
    throw new TenantUserDirectoryError('SF-SYS-003', 400, 'Invalid email');
  }
  return email;
}

function normalizeDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new TenantUserDirectoryError('SF-SYS-003', 400, 'Invalid display_name');
  }
  return trimmed;
}

/** SIMULATED in-memory directory scoped by tenant_id. Seeded from officers.json for SAMPLE_LAB. */
export class SimulatedTenantUserDirectory implements TenantUserDirectory {
  readonly mode = 'SIMULATED' as const;
  readonly simulation = true;
  private readonly byTenant = new Map<string, Map<string, TenantWorkforceUser>>();
  private readonly catalogues = new Map<string, string[]>();

  constructor(seedOfficers: readonly LabOfficer[] = [], roleCatalogue = DEFAULT_ROLE_CATALOGUE) {
    for (const officer of seedOfficers) {
      const bucket = this.bucket(officer.tenant_id);
      const user: TenantWorkforceUser = {
        user_id: officer.officer_id,
        username: officer.subject,
        display_name: officer.display_name,
        email: null,
        enabled: true,
        roles: [...officer.roles],
        tenant_id: officer.tenant_id,
      };
      bucket.set(user.user_id, user);
      const cat = new Set(this.catalogues.get(officer.tenant_id) ?? [...roleCatalogue]);
      for (const role of officer.roles) cat.add(role);
      this.catalogues.set(officer.tenant_id, [...cat].sort());
    }
  }

  private bucket(tenantId: string): Map<string, TenantWorkforceUser> {
    let map = this.byTenant.get(tenantId);
    if (!map) {
      map = new Map();
      this.byTenant.set(tenantId, map);
      if (!this.catalogues.has(tenantId)) {
        this.catalogues.set(tenantId, [...DEFAULT_ROLE_CATALOGUE]);
      }
    }
    return map;
  }

  async list(tenantId: string): Promise<TenantWorkforceUser[]> {
    return [...this.bucket(tenantId).values()].map((u) => ({ ...u, roles: [...u.roles] }));
  }

  async get(tenantId: string, userId: string): Promise<TenantWorkforceUser | null> {
    const user = this.bucket(tenantId).get(userId);
    return user ? { ...user, roles: [...user.roles] } : null;
  }

  async create(tenantId: string, input: CreateTenantUserInput): Promise<TenantWorkforceUser> {
    const username = assertUsername(input.username);
    const bucket = this.bucket(tenantId);
    for (const existing of bucket.values()) {
      if (existing.username === username) {
        throw new TenantUserDirectoryError('SF-SYS-003', 409, 'Username already exists');
      }
    }
    const roles = assertRoleCodes(input.roles ?? []);
    const user: TenantWorkforceUser = {
      user_id: randomUUID(),
      username,
      display_name: normalizeDisplayName(input.display_name),
      email: normalizeEmail(input.email),
      enabled: input.enabled !== false,
      roles,
      tenant_id: tenantId,
    };
    bucket.set(user.user_id, user);
    return { ...user, roles: [...user.roles] };
  }

  async update(
    tenantId: string,
    userId: string,
    input: UpdateTenantUserInput,
  ): Promise<TenantWorkforceUser> {
    const existing = this.bucket(tenantId).get(userId);
    if (!existing) throw new TenantUserDirectoryError('SF-SYS-002', 404, 'User not found');
    const next: TenantWorkforceUser = {
      ...existing,
      display_name:
        input.display_name !== undefined
          ? normalizeDisplayName(input.display_name)
          : existing.display_name,
      email: input.email !== undefined ? normalizeEmail(input.email) : existing.email,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled,
    };
    this.bucket(tenantId).set(userId, next);
    return { ...next, roles: [...next.roles] };
  }

  async assignRoles(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<TenantWorkforceUser> {
    const existing = this.bucket(tenantId).get(userId);
    if (!existing) throw new TenantUserDirectoryError('SF-SYS-002', 404, 'User not found');
    const next = { ...existing, roles: assertRoleCodes(roles) };
    this.bucket(tenantId).set(userId, next);
    return { ...next, roles: [...next.roles] };
  }

  async roleCatalogue(tenantId: string): Promise<string[]> {
    this.bucket(tenantId);
    return [...(this.catalogues.get(tenantId) ?? DEFAULT_ROLE_CATALOGUE)];
  }
}

export interface KeycloakTenantUserConfig {
  baseUrl: string;
  adminRealm: string;
  clientId: string;
  clientSecret: string;
  /** tenant_id → Keycloak realm name. */
  realmByTenant: Record<string, string>;
  /** When set, only users with this attribute matching tenant_id are visible. */
  tenantAttribute?: string;
  fetchImpl?: typeof fetch;
}

function parseRealmMap(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (UUID_RE.test(k) && typeof v === 'string' && v.length > 0 && v.length <= 128) {
        out[k.toLowerCase()] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Env keys that signal Keycloak intent. Partial presence must fail closed (no silent SIM). */
export const KEYCLOAK_ENV_HINT_KEYS = [
  'SF_KEYCLOAK_BASE_URL',
  'SF_KEYCLOAK_ADMIN_CLIENT_ID',
  'SF_KEYCLOAK_ADMIN_CLIENT_SECRET',
  'SF_KEYCLOAK_ADMIN_REALM',
  'SF_KEYCLOAK_REALM',
  'SF_KEYCLOAK_TENANT_ID',
  'SF_KEYCLOAK_TENANT_REALM_MAP',
  'SF_KEYCLOAK_TENANT_ATTRIBUTE',
] as const;

export function keycloakEnvHintsPresent(env: Record<string, string | undefined>): boolean {
  return KEYCLOAK_ENV_HINT_KEYS.some((key) => (env[key] ?? '').trim() !== '');
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

/**
 * Resolve Keycloak adapter config from env.
 * - No Keycloak hints → null (SIMULATED is allowed).
 * - Any Keycloak hint without a complete valid binding → throw (fail-closed; no silent SIM).
 * Does not claim production IdP / ADR-0007 acceptance.
 */
export function resolveKeycloakConfig(
  env: Record<string, string | undefined>,
): KeycloakTenantUserConfig | null {
  const hints = keycloakEnvHintsPresent(env);
  const baseUrl = (env['SF_KEYCLOAK_BASE_URL'] ?? '').trim().replace(/\/$/, '');
  const clientId = (env['SF_KEYCLOAK_ADMIN_CLIENT_ID'] ?? '').trim();
  const clientSecret = (env['SF_KEYCLOAK_ADMIN_CLIENT_SECRET'] ?? '').trim();
  const adminRealm = (env['SF_KEYCLOAK_ADMIN_REALM'] ?? 'master').trim() || 'master';
  const realmByTenant = parseRealmMap(env['SF_KEYCLOAK_TENANT_REALM_MAP']);
  const singleRealm = (env['SF_KEYCLOAK_REALM'] ?? '').trim();
  const singleTenant = (env['SF_KEYCLOAK_TENANT_ID'] ?? '').trim();
  if (singleRealm && UUID_RE.test(singleTenant) && !realmByTenant[singleTenant.toLowerCase()]) {
    realmByTenant[singleTenant.toLowerCase()] = singleRealm;
  }
  const complete =
    Boolean(baseUrl) &&
    isHttpUrl(baseUrl) &&
    Boolean(clientId) &&
    Boolean(clientSecret) &&
    Object.keys(realmByTenant).length > 0;
  if (!hints) return null;
  if (!complete) {
    throw new TenantUserDirectoryError(
      'SF-SYS-003',
      503,
      'Keycloak env misconfigured — SIMULATED fallback refused',
    );
  }
  return {
    baseUrl,
    adminRealm,
    clientId,
    clientSecret,
    realmByTenant,
    tenantAttribute: (env['SF_KEYCLOAK_TENANT_ATTRIBUTE'] ?? 'tenant_id').trim() || 'tenant_id',
  };
}

export function createTenantUserDirectory(opts: {
  env: Record<string, string | undefined>;
  officers?: readonly LabOfficer[];
}): TenantUserDirectory {
  const kc = resolveKeycloakConfig(opts.env);
  if (kc) return new KeycloakTenantUserDirectory(kc);
  return new SimulatedTenantUserDirectory(opts.officers ?? []);
}

/** Log-safe fields only — never email/username/display_name. */
export function safeTenantUserLogFields(
  event: string,
  fields: { user_id?: string; count?: number; role_count?: number; tenant_bound?: boolean },
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { event };
  if (typeof fields.user_id === 'string') out['user_id'] = fields.user_id;
  if (typeof fields.count === 'number') out['count'] = fields.count;
  if (typeof fields.role_count === 'number') out['role_count'] = fields.role_count;
  if (typeof fields.tenant_bound === 'boolean') out['tenant_bound'] = fields.tenant_bound;
  return out;
}

/** Client-supplied tenant_id in body is always refused (SF-TEN-002). */
export function assertNoClientTenantOverride(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  if (!Object.prototype.hasOwnProperty.call(body, 'tenant_id')) return;
  const supplied = (body as Record<string, unknown>)['tenant_id'];
  if (supplied === undefined || supplied === null || supplied === '') return;
  throw new TenantUserDirectoryError('SF-TEN-002', 403, 'Tenant override refused');
}

type KcToken = { access_token: string; expires_at: number };

/** Keycloak Admin REST adapter — realm scoped by tenant binding; never cross-tenant. */
export class KeycloakTenantUserDirectory implements TenantUserDirectory {
  readonly mode = 'KEYCLOAK' as const;
  readonly simulation = false;
  private token: KcToken | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: KeycloakTenantUserConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private realmFor(tenantId: string): string {
    const realm = this.config.realmByTenant[tenantId.toLowerCase()];
    if (!realm) {
      throw new TenantUserDirectoryError(
        'SF-SYS-003',
        400,
        'No Keycloak realm binding for this tenant',
      );
    }
    return realm;
  }

  private async adminToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expires_at > now + 5_000) return this.token.access_token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const res = await this.fetchImpl(
      `${this.config.baseUrl}/realms/${encodeURIComponent(this.config.adminRealm)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
        redirect: 'error',
      },
    );
    if (!res.ok) {
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak token request failed');
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof json.access_token !== 'string') {
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak token missing');
    }
    const ttl = typeof json.expires_in === 'number' ? json.expires_in : 60;
    this.token = { access_token: json.access_token, expires_at: now + ttl * 1000 };
    return json.access_token;
  }

  private async adminFetch(realm: string, path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.adminToken();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    headers.set('accept', 'application/json');
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return this.fetchImpl(
      `${this.config.baseUrl}/admin/realms/${encodeURIComponent(realm)}${path}`,
      { ...init, headers, redirect: 'error' },
    );
  }

  private attrTenant(user: Record<string, unknown>, tenantId: string): boolean {
    const attrName = this.config.tenantAttribute ?? 'tenant_id';
    const attrs = user['attributes'];
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return false;
    const values = (attrs as Record<string, unknown>)[attrName];
    if (Array.isArray(values)) return values.map(String).includes(tenantId);
    if (typeof values === 'string') return values === tenantId;
    return false;
  }

  private mapUser(
    tenantId: string,
    raw: Record<string, unknown>,
    roles: string[],
  ): TenantWorkforceUser {
    const id = typeof raw['id'] === 'string' ? raw['id'] : '';
    if (!id) throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak user id missing');
    return {
      user_id: id,
      username: typeof raw['username'] === 'string' ? raw['username'] : id,
      display_name:
        typeof raw['firstName'] === 'string' && raw['firstName']
          ? String(raw['firstName'])
          : typeof raw['username'] === 'string'
            ? raw['username']
            : id,
      email: typeof raw['email'] === 'string' ? raw['email'] : null,
      enabled: raw['enabled'] !== false,
      roles,
      tenant_id: tenantId,
    };
  }

  private async realmRoles(realm: string, userId: string): Promise<string[]> {
    const res = await this.adminFetch(
      realm,
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as { name?: string }[];
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => r.name)
      .filter((n): n is string => typeof n === 'string' && ROLE_RE.test(n));
  }

  async list(tenantId: string): Promise<TenantWorkforceUser[]> {
    const realm = this.realmFor(tenantId);
    const res = await this.adminFetch(realm, '/users?max=200');
    if (!res.ok) {
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak list users failed');
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    if (!Array.isArray(rows)) return [];
    const out: TenantWorkforceUser[] = [];
    for (const raw of rows) {
      if (!this.attrTenant(raw, tenantId)) continue;
      const id = typeof raw['id'] === 'string' ? raw['id'] : '';
      if (!id) continue;
      const roles = await this.realmRoles(realm, id);
      out.push(this.mapUser(tenantId, raw, roles));
    }
    return out;
  }

  async get(tenantId: string, userId: string): Promise<TenantWorkforceUser | null> {
    const realm = this.realmFor(tenantId);
    const res = await this.adminFetch(realm, `/users/${encodeURIComponent(userId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak get user failed');
    const raw = (await res.json()) as Record<string, unknown>;
    if (!this.attrTenant(raw, tenantId)) return null;
    const roles = await this.realmRoles(realm, userId);
    return this.mapUser(tenantId, raw, roles);
  }

  async create(tenantId: string, input: CreateTenantUserInput): Promise<TenantWorkforceUser> {
    const realm = this.realmFor(tenantId);
    const username = assertUsername(input.username);
    const display_name = normalizeDisplayName(input.display_name);
    const email = normalizeEmail(input.email);
    const attrName = this.config.tenantAttribute ?? 'tenant_id';
    const body: Record<string, unknown> = {
      username,
      enabled: input.enabled !== false,
      firstName: display_name,
      attributes: { [attrName]: [tenantId] },
    };
    if (email) body['email'] = email;
    const res = await this.adminFetch(realm, '/users', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      throw new TenantUserDirectoryError('SF-SYS-003', 409, 'Username already exists');
    }
    if (res.status !== 201) {
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak create user failed');
    }
    const location = res.headers.get('location') ?? '';
    const userId = location.split('/').pop() ?? '';
    if (!userId) {
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak create location missing');
    }
    const roles = assertRoleCodes(input.roles ?? []);
    if (roles.length > 0) await this.assignRoles(tenantId, userId, roles);
    const created = await this.get(tenantId, userId);
    if (!created)
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak create verify failed');
    return created;
  }

  async update(
    tenantId: string,
    userId: string,
    input: UpdateTenantUserInput,
  ): Promise<TenantWorkforceUser> {
    const existing = await this.get(tenantId, userId);
    if (!existing) throw new TenantUserDirectoryError('SF-SYS-002', 404, 'User not found');
    const realm = this.realmFor(tenantId);
    const attrName = this.config.tenantAttribute ?? 'tenant_id';
    const body: Record<string, unknown> = {
      username: existing.username,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled,
      firstName:
        input.display_name !== undefined
          ? normalizeDisplayName(input.display_name)
          : existing.display_name,
      attributes: { [attrName]: [tenantId] },
    };
    const email = input.email !== undefined ? normalizeEmail(input.email) : existing.email;
    if (email) body['email'] = email;
    const res = await this.adminFetch(realm, `/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak update user failed');
    const updated = await this.get(tenantId, userId);
    if (!updated)
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak update verify failed');
    return updated;
  }

  async assignRoles(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<TenantWorkforceUser> {
    const existing = await this.get(tenantId, userId);
    if (!existing) throw new TenantUserDirectoryError('SF-SYS-002', 404, 'User not found');
    const realm = this.realmFor(tenantId);
    const desired = assertRoleCodes(roles);
    const availableRes = await this.adminFetch(realm, '/roles');
    if (!availableRes.ok) {
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak roles list failed');
    }
    const available = (await availableRes.json()) as { id?: string; name?: string }[];
    const byName = new Map(
      available
        .filter((r) => typeof r.name === 'string' && typeof r.id === 'string')
        .map((r) => [r.name as string, { id: r.id as string, name: r.name as string }]),
    );
    const missing = desired.filter((n) => !byName.has(n));
    if (missing.length > 0) {
      throw new TenantUserDirectoryError(
        'SF-SYS-003',
        400,
        'Unknown Keycloak realm role — refuse partial assign',
      );
    }
    const current = await this.realmRoles(realm, userId);
    const toRemove = current
      .filter((n) => !desired.includes(n))
      .map((n) => byName.get(n))
      .filter((r): r is { id: string; name: string } => Boolean(r));
    const toAdd = desired
      .map((n) => byName.get(n))
      .filter((r): r is { id: string; name: string } => Boolean(r));
    if (toRemove.length > 0) {
      const del = await this.adminFetch(
        realm,
        `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
        { method: 'DELETE', body: JSON.stringify(toRemove) },
      );
      if (!del.ok) {
        throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak role remove failed');
      }
    }
    if (toAdd.length > 0) {
      const add = await this.adminFetch(
        realm,
        `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
        { method: 'POST', body: JSON.stringify(toAdd) },
      );
      if (!add.ok) {
        throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak role add failed');
      }
    }
    const updated = await this.get(tenantId, userId);
    if (!updated)
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak roles verify failed');
    return updated;
  }

  async roleCatalogue(tenantId: string): Promise<string[]> {
    const realm = this.realmFor(tenantId);
    const res = await this.adminFetch(realm, '/roles');
    if (!res.ok) {
      throw new TenantUserDirectoryError('SF-SYS-004', 502, 'Keycloak roles catalogue failed');
    }
    const rows = (await res.json()) as { name?: string }[];
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => r.name)
      .filter((n): n is string => typeof n === 'string' && ROLE_RE.test(n))
      .sort();
  }
}

async function authorizeWorkforce(
  authorizer: TenantUserAuthzPort,
  ctx: TenantUserRequestContext,
  action: string,
  resourceType: 'WorkforceUser' | 'WorkforceRoleCatalogue',
): Promise<void> {
  if (!ctx.tenant_id) {
    throw new TenantUserDirectoryError('SF-AUTH-002', 403, 'Authorization denied');
  }
  let decision: { allow?: unknown };
  try {
    decision = await authorizer.decide({
      subject: {
        user_id: ctx.actor.id,
        actor_type: ctx.actor.type,
        tenant_id: ctx.tenant_id,
        roles: ctx.roles,
        jurisdiction_ids: ctx.jurisdiction_ids,
        assurance: ctx.auth_assurance,
      },
      resource: {
        resource_type: resourceType,
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action,
      environment: {
        request_time: new Date().toISOString(),
        trace_id: ctx.trace_id,
      },
    });
  } catch {
    throw new TenantUserDirectoryError('SF-SYS-004', 503, 'Authorization service unavailable');
  }
  if (decision.allow !== true) {
    throw new TenantUserDirectoryError('SF-AUTH-002', 403, 'Authorization denied');
  }
}

function envelope(directory: TenantUserDirectory, extra: Record<string, unknown>) {
  return {
    source: 'SAMPLE_LAB',
    adapter_mode: directory.mode,
    simulation: directory.simulation,
    certified: false,
    g6_issued: false,
    adr_0007_accepted: false,
    production_idp_claimed: false,
    ...extra,
  };
}

function errorReply(err: unknown): { status: number; body: Record<string, unknown> } {
  // Never echo adapter/internal detail to clients (may include upstream text).
  if (err instanceof TenantUserDirectoryError) {
    return {
      status: err.status,
      body: { error_code: err.code, message: 'Request denied' },
    };
  }
  return { status: 500, body: { error_code: 'SF-SYS-001', message: 'Unexpected server error' } };
}

type OfficerTenantContext = TenantUserRequestContext & { tenant_id: string };

/**
 * Lab + Admin BFF routes (not a frozen CMP OpenAPI — no CCR):
 * GET    /v1/admin/tenant-users
 * POST   /v1/admin/tenant-users
 * GET    /v1/admin/tenant-users/:userId
 * PATCH  /v1/admin/tenant-users/:userId
 * PUT    /v1/admin/tenant-users/:userId/roles
 * GET    /v1/admin/tenant-users/meta/roles
 * GET    /v1/admin/tenant-users/meta/adapter
 */
export function registerTenantUserAdminRoutes(
  app: FastifyInstance,
  opts: {
    directory: TenantUserDirectory;
    authorizer: TenantUserAuthzPort;
    resolveContext: (request: FastifyRequest) => Promise<TenantUserRequestContext | null>;
  },
): void {
  const requireOfficer = async (request: FastifyRequest): Promise<OfficerTenantContext> => {
    const ctx = await opts.resolveContext(request);
    if (!ctx || ctx.actor.type !== 'OFFICER' || typeof ctx.tenant_id !== 'string') {
      throw new TenantUserDirectoryError('SF-AUTH-001', 401, 'Officer session required');
    }
    return { ...ctx, tenant_id: ctx.tenant_id };
  };

  app.get('/v1/admin/tenant-users/meta/adapter', async (request, reply) => {
    try {
      const ctx = await requireOfficer(request);
      await authorizeWorkforce(opts.authorizer, ctx, 'WORKFORCE_USER_LIST', 'WorkforceUser');
      return reply.header('cache-control', 'no-store').send(
        envelope(opts.directory, {
          tenant_bound: true,
          keycloak_console_embedded: false,
        }),
      );
    } catch (err) {
      const mapped = errorReply(err);
      return reply.code(mapped.status).header('cache-control', 'no-store').send(mapped.body);
    }
  });

  app.get('/v1/admin/tenant-users/meta/roles', async (request, reply) => {
    try {
      const ctx = await requireOfficer(request);
      await authorizeWorkforce(
        opts.authorizer,
        ctx,
        'WORKFORCE_ROLE_CATALOGUE_READ',
        'WorkforceRoleCatalogue',
      );
      const roles = await opts.directory.roleCatalogue(ctx.tenant_id);
      return reply
        .header('cache-control', 'no-store')
        .send(envelope(opts.directory, { roles, tenant_id: ctx.tenant_id }));
    } catch (err) {
      const mapped = errorReply(err);
      return reply.code(mapped.status).header('cache-control', 'no-store').send(mapped.body);
    }
  });

  app.get('/v1/admin/tenant-users', async (request, reply) => {
    try {
      const ctx = await requireOfficer(request);
      await authorizeWorkforce(opts.authorizer, ctx, 'WORKFORCE_USER_LIST', 'WorkforceUser');
      const users = await opts.directory.list(ctx.tenant_id);
      // Use server logger (not request.log) so Fastify does not attach req.body PII.
      request.server.log.info(
        safeTenantUserLogFields('tenant_users_list', {
          tenant_bound: true,
          count: users.length,
        }),
        'tenant users listed',
      );
      return reply
        .header('cache-control', 'no-store')
        .send(envelope(opts.directory, { users, tenant_id: ctx.tenant_id }));
    } catch (err) {
      const mapped = errorReply(err);
      return reply.code(mapped.status).header('cache-control', 'no-store').send(mapped.body);
    }
  });

  app.get<{ Params: { userId: string } }>(
    '/v1/admin/tenant-users/:userId',
    async (request, reply) => {
      try {
        const ctx = await requireOfficer(request);
        await authorizeWorkforce(opts.authorizer, ctx, 'WORKFORCE_USER_READ', 'WorkforceUser');
        const user = await opts.directory.get(ctx.tenant_id, request.params.userId);
        if (!user) {
          return reply
            .code(404)
            .header('cache-control', 'no-store')
            .send({ error_code: 'SF-SYS-002', message: 'Resource or route not found' });
        }
        return reply
          .header('cache-control', 'no-store')
          .send(envelope(opts.directory, { user, tenant_id: ctx.tenant_id }));
      } catch (err) {
        const mapped = errorReply(err);
        return reply.code(mapped.status).header('cache-control', 'no-store').send(mapped.body);
      }
    },
  );

  app.post('/v1/admin/tenant-users', async (request, reply) => {
    try {
      const ctx = await requireOfficer(request);
      await authorizeWorkforce(opts.authorizer, ctx, 'WORKFORCE_USER_CREATE', 'WorkforceUser');
      const body = (request.body ?? {}) as Record<string, unknown>;
      assertNoClientTenantOverride(body);
      const user = await opts.directory.create(ctx.tenant_id, {
        username: typeof body['username'] === 'string' ? body['username'] : '',
        display_name: typeof body['display_name'] === 'string' ? body['display_name'] : '',
        email: typeof body['email'] === 'string' ? body['email'] : null,
        enabled: body['enabled'] !== false,
        roles: Array.isArray(body['roles'])
          ? body['roles'].filter((r): r is string => typeof r === 'string')
          : [],
      });
      request.server.log.info(
        safeTenantUserLogFields('tenant_user_create', {
          user_id: user.user_id,
          tenant_bound: true,
        }),
        'tenant user created',
      );
      return reply
        .code(201)
        .header('cache-control', 'no-store')
        .send(envelope(opts.directory, { user, tenant_id: ctx.tenant_id }));
    } catch (err) {
      const mapped = errorReply(err);
      return reply.code(mapped.status).header('cache-control', 'no-store').send(mapped.body);
    }
  });

  app.patch<{ Params: { userId: string } }>(
    '/v1/admin/tenant-users/:userId',
    async (request, reply) => {
      try {
        const ctx = await requireOfficer(request);
        await authorizeWorkforce(opts.authorizer, ctx, 'WORKFORCE_USER_UPDATE', 'WorkforceUser');
        const body = (request.body ?? {}) as Record<string, unknown>;
        assertNoClientTenantOverride(body);
        const patch: UpdateTenantUserInput = {};
        if (typeof body['display_name'] === 'string') patch.display_name = body['display_name'];
        if (body['email'] === null || typeof body['email'] === 'string') {
          patch.email = body['email'] as string | null;
        }
        if (typeof body['enabled'] === 'boolean') patch.enabled = body['enabled'];
        const user = await opts.directory.update(ctx.tenant_id, request.params.userId, patch);
        request.server.log.info(
          safeTenantUserLogFields('tenant_user_update', {
            user_id: user.user_id,
            tenant_bound: true,
          }),
          'tenant user updated',
        );
        return reply
          .header('cache-control', 'no-store')
          .send(envelope(opts.directory, { user, tenant_id: ctx.tenant_id }));
      } catch (err) {
        const mapped = errorReply(err);
        return reply.code(mapped.status).header('cache-control', 'no-store').send(mapped.body);
      }
    },
  );

  app.put<{ Params: { userId: string } }>(
    '/v1/admin/tenant-users/:userId/roles',
    async (request, reply) => {
      try {
        const ctx = await requireOfficer(request);
        await authorizeWorkforce(
          opts.authorizer,
          ctx,
          'WORKFORCE_USER_ASSIGN_ROLES',
          'WorkforceUser',
        );
        const body = (request.body ?? {}) as Record<string, unknown>;
        assertNoClientTenantOverride(body);
        const roles = Array.isArray(body['roles'])
          ? body['roles'].filter((r): r is string => typeof r === 'string')
          : [];
        const user = await opts.directory.assignRoles(ctx.tenant_id, request.params.userId, roles);
        request.server.log.info(
          safeTenantUserLogFields('tenant_user_roles', {
            user_id: user.user_id,
            role_count: user.roles.length,
            tenant_bound: true,
          }),
          'tenant user roles assigned',
        );
        return reply
          .header('cache-control', 'no-store')
          .send(envelope(opts.directory, { user, tenant_id: ctx.tenant_id }));
      } catch (err) {
        const mapped = errorReply(err);
        return reply.code(mapped.status).header('cache-control', 'no-store').send(mapped.body);
      }
    },
  );
}
