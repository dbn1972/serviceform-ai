import { validate, type RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';

export const fixtures = new Map<string, RequestContext>();

export async function fixtureResolver(request: FastifyRequest): Promise<RequestContext | null> {
  const header = request.headers.authorization;
  if (!header || Array.isArray(header) || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const ctx = fixtures.get(token);
  if (!ctx) return null;
  const checked = validate('request-context', ctx);
  return checked.valid ? ctx : null;
}
