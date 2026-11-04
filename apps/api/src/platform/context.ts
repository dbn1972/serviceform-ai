import { randomUUID } from 'node:crypto';
import type { AuthAssurance, RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import type { PortalPlacement } from './placement.js';

/** Structural subset of CMP-004 IdentityPrincipalVerifier (bearer → session_lookup). */
export interface PrincipalPort {
  verify(request: FastifyRequest): Promise<{
    subject_id: string;
    actor_type: string;
    assurance: AuthAssurance;
  } | null>;
}

/** Structural subset of CMP-004 IdentityContextResolver. */
export interface SessionContextPort {
  resolve(
    principal: { subject_id: string; actor_type: string; assurance: AuthAssurance },
    opts: { cellId: string },
  ): Promise<Omit<RequestContext, 'correlation_id' | 'trace_id'> | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function correlationOf(request: FastifyRequest): string {
  return UUID.test(request.id) ? request.id.toLowerCase() : randomUUID();
}

/**
 * ADR-0007 D-1. Identity always comes from the CMP-004 session behind the bearer token. A
 * citizen's tenant and cell come from this host's portal placement, never from the request. An
 * officer keeps the tenant of their CMP-004 session, which must be the placement tenant.
 */
export function placementContextResolver(deps: {
  verifier: PrincipalPort;
  sessions: SessionContextPort;
  placement: PortalPlacement;
}): (request: FastifyRequest) => Promise<RequestContext | null> {
  const { placement } = deps;
  return async (request) => {
    const principal = await deps.verifier.verify(request);
    if (!principal) return null;
    const resolved = await deps.sessions.resolve(principal, { cellId: placement.cell_id });
    if (!resolved) return null;
    const correlation_id = correlationOf(request);
    const trace_id = correlation_id.replace(/-/g, '');
    if (principal.actor_type === 'CITIZEN' && resolved.actor.type === 'CITIZEN') {
      return {
        tenant_id: placement.tenant_id,
        cell_id: placement.cell_id,
        actor: { type: 'CITIZEN', id: resolved.actor.id },
        roles: [],
        jurisdiction_ids: [],
        auth_assurance: resolved.auth_assurance,
        correlation_id,
        trace_id,
      };
    }
    if (principal.actor_type === 'OFFICER' && resolved.actor.type === 'OFFICER') {
      if (resolved.tenant_id !== placement.tenant_id) return null;
      return {
        tenant_id: resolved.tenant_id,
        cell_id: placement.cell_id,
        actor: { type: 'OFFICER', id: resolved.actor.id },
        roles: [...resolved.roles],
        jurisdiction_ids: [...resolved.jurisdiction_ids],
        auth_assurance: resolved.auth_assurance,
        correlation_id,
        trace_id,
      };
    }
    return null;
  };
}
