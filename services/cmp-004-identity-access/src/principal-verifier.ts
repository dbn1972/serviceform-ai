import type { AuthAssurance, RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
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
  lookupActiveBySubject(principal: VerifiedPrincipal): Promise<SessionLookupRow | null>;
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
      let role_codes: string[] = [];
      if (row.actor_type === 'OFFICER' && row.tenant_id) {
        await client.query('BEGIN');
        try {
          await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', row.tenant_id]);
          const sess = await client.query<{ role_codes: string[] }>(
            `SELECT role_codes FROM sf_identity.officer_session
              WHERE tenant_id = $1 AND session_id = $2 AND status = 'ACTIVE'`,
            [row.tenant_id, row.session_id],
          );
          role_codes = sess.rows[0]?.role_codes ?? [];
          await client.query('COMMIT');
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        }
      }
      return { ...row, role_codes };
    } finally {
      client.release();
    }
  }

  async lookupActiveBySubject(principal: VerifiedPrincipal): Promise<SessionLookupRow | null> {
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
          WHERE subject_id = $1 AND actor_type = $2 AND status = 'ACTIVE'
          ORDER BY expires_at DESC
          LIMIT 1`,
        [principal.subject_id, principal.actor_type],
      );
      const row = found.rows[0];
      if (!row) return null;
      if (row.expires_at.getTime() <= this.clock().getTime()) return null;
      return { ...row, role_codes: [] };
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
    const row = await this.directory.lookupActiveBySubject(principal);
    if (!row) return null;
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
        roles: row.role_codes.length > 0 ? row.role_codes : ['SERVICE_CHECKER'],
        jurisdiction_ids: [],
        auth_assurance: principal.assurance,
      };
    }
    return null;
  }
}
