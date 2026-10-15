import type { RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import type { ContextResolver } from '../../src/context.js';

export const fixtures = new Map<string, RequestContext>();

export const fixtureResolver: ContextResolver = async (request: FastifyRequest) => {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length);
  return fixtures.get(token) ?? null;
};

export function setFixture(token: string, ctx: RequestContext): void {
  fixtures.set(token, ctx);
}
