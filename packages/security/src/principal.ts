import type { ActorType, AuthAssurance, RequestContext, Uuid } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';

export interface VerifiedPrincipal {
  subject_id: Uuid;
  actor_type: ActorType;
  assurance: AuthAssurance;
  client_id?: string;
  purpose?: string;
}

export interface PrincipalVerifier {
  verify(request: FastifyRequest): Promise<VerifiedPrincipal | null>;
}

export type ResolvedContext = Omit<RequestContext, 'correlation_id' | 'trace_id'>;

export interface ContextResolver {
  resolve(principal: VerifiedPrincipal, opts: { cellId: string }): Promise<ResolvedContext | null>;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return value;
  }
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
