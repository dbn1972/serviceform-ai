import type { AuthAssurance, RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { ContextResolver, PrincipalVerifier, VerifiedPrincipal } from '@serviceform/security';
import { tokenFingerprint } from './hashing.js';

export interface SessionLookupRow {
  session_id: string;
  actor_type: 'CITIZEN' | 'OFFICER';
  subject_id: string;
  tenant_id: string | null;
  assurance: AuthAssurance;
  status: string;
  expires_at: Date;
  role_codes: string[];
}

export interface SessionDirectory {
  lookupByToken(token: string): Promise<SessionLookupRow | null>;
}

/**
 * Officer role codes live in the tenant-scoped officer_session row, read under that tenant's RLS.
 * Null when the session or its officer principal is no longer ACTIVE (a DISABLED officer's
 * existing sessions stop working at once).
 */
async function activeOfficerRoleCodes(
  client: PoolClient,
  tenantId: string,
  sessionId: string,
): Promise<string[] | null> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const sess = await client.query<{ role_codes: string[] }>(
      `SELECT s.role_codes FROM sf_identity.officer_session s
         JOIN sf_identity.officer_principal p
           ON p.tenant_id = s.tenant_id AND p.officer_id = s.officer_id
        WHERE s.tenant_id = $1 AND s.session_id = $2 AND s.status = 'ACTIVE' AND p.status = 'ACTIVE'`,
      [tenantId, sessionId],
    );
    await client.query('COMMIT');
    return sess.rows[0] ? sess.rows[0].role_codes : null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export class PgSessionDirectory implements SessionDirectory {
  constructor(
    private readonly pool: Pool,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async lookupByToken(token: string): Promise<SessionLookupRow | null> {
    const hash = tokenFingerprint(token);
    const client = await this.pool.connect();
    try {
      const found = await client.query<{
        session_id: string;
        actor_type: 'CITIZEN' | 'OFFICER';
        subject_id: string;
        tenant_id: string | null;
        assurance: AuthAssurance;
        status: string;
        expires_at: Date;
      }>(
        `SELECT session_id, actor_type, subject_id, tenant_id, assurance, status, expires_at
           FROM sf_identity.session_lookup
          WHERE token_hash = $1`,
        [hash],
      );
      const row = found.rows[0];
      if (!row) return null;
      if (row.status !== 'ACTIVE') return null;
      if (row.expires_at.getTime() <= this.clock().getTime()) return null;
      if (row.actor_type !== 'OFFICER') return { ...row, role_codes: [] };
      if (!row.tenant_id) return null;
      const role_codes = await activeOfficerRoleCodes(client, row.tenant_id, row.session_id);
      return role_codes ? { ...row, role_codes } : null;
    } finally {
      client.release();
    }
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * The session row behind each verified principal. The context is resolved from the presented
 * token's own session only, never from another session of the same subject: an officer with
 * sessions in two tenants must get exactly the tenant and roles of the token they presented.
 */
const verifiedSessions = new WeakMap<VerifiedPrincipal, SessionLookupRow>();

export class IdentityPrincipalVerifier implements PrincipalVerifier {
  constructor(private readonly directory: SessionDirectory) {}

  async verify(request: FastifyRequest): Promise<VerifiedPrincipal | null> {
    const token = bearerToken(request);
    if (!token) return null;
    const row = await this.directory.lookupByToken(token);
    if (!row) return null;
    const principal: VerifiedPrincipal = {
      subject_id: row.subject_id,
      actor_type: row.actor_type,
      assurance: row.assurance,
    };
    verifiedSessions.set(principal, row);
    return principal;
  }
}

export class IdentityContextResolver implements ContextResolver {
  constructor(
    private readonly directory: SessionDirectory,
    private readonly cellId: string,
  ) {}

  async resolve(
    principal: VerifiedPrincipal,
    opts: { cellId: string },
  ): Promise<Omit<RequestContext, 'correlation_id' | 'trace_id'> | null> {
    const row = verifiedSessions.get(principal);
    if (!row) return null;
    if (row.subject_id !== principal.subject_id || row.actor_type !== principal.actor_type)
      return null;
    if (row.status !== 'ACTIVE') return null;
    if (principal.actor_type === 'CITIZEN') {
      return {
        tenant_id: null,
        cell_id: opts.cellId || this.cellId,
        actor: { type: 'CITIZEN', id: principal.subject_id },
        roles: [],
        jurisdiction_ids: [],
        auth_assurance: principal.assurance,
      };
    }
    if (principal.actor_type === 'OFFICER') {
      if (!row.tenant_id) return null;
      return {
        tenant_id: row.tenant_id,
        cell_id: opts.cellId || this.cellId,
        actor: { type: 'OFFICER', id: principal.subject_id },
        roles: [...row.role_codes],
        jurisdiction_ids: [],
        auth_assurance: principal.assurance,
      };
    }
    return null;
  }
}
