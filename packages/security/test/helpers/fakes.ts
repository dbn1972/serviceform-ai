import type { RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import type { ContextResolver, PrincipalVerifier, VerifiedPrincipal } from '../../src/principal.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CELL = 'cell-01';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';

export function principal(over: Partial<VerifiedPrincipal> = {}): VerifiedPrincipal {
  return { subject_id: U1, actor_type: 'OFFICER', assurance: 'MFA', ...over };
}

export function context(over: Partial<RequestContext> = {}): RequestContext {
  return {
    tenant_id: T1,
    cell_id: CELL,
    actor: { type: 'OFFICER', id: U1 },
    roles: ['ROLE_A'],
    jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
    auth_assurance: 'MFA',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: TRACE,
    ...over,
  };
}

export const stubVerifier = (p: VerifiedPrincipal | null = principal()): PrincipalVerifier => ({
  verify: async (_req: FastifyRequest) => p,
});

export const stubResolver = (
  ctx: Omit<RequestContext, 'correlation_id' | 'trace_id'> | null = context(),
): ContextResolver => ({
  resolve: async () => ctx,
});
