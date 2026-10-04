import { randomUUID } from 'node:crypto';
import { errorEntry } from '@serviceform/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Client-supplied tenant / identity headers are never authoritative (Constitution #6, TI v1.0). */
const ROLE_ACTOR_HEADERS = new Set([
  'x-roles',
  'x-org-id',
  'x-actor-type',
  'x-assurance',
  'x-delegation-id',
  'x-request-time',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isForbiddenEdgeHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('tenant')) return true;
  if (n.startsWith('x-sf-')) return true;
  if (n === 'x-tenant-id') return true;
  return ROLE_ACTOR_HEADERS.has(n);
}

export function forwardedCarriesTenant(value: string): boolean {
  return /(?:^|;|\s)tenant\s*=/i.test(value);
}

export function findForbiddenEdgeHeader(headers: FastifyRequest['headers']): string | undefined {
  for (const [name, raw] of Object.entries(headers)) {
    if (isForbiddenEdgeHeaderName(name)) return name;
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (forwardedCarriesTenant(String(text))) return name;
    }
  }
  return undefined;
}

function correlationId(requestId: string): string {
  return UUID.test(requestId) ? requestId.toLowerCase() : randomUUID();
}

/** Returns a frozen ErrorResponse body for forged tenant/identity headers. */
export function forgedTenantErrorBody(requestId: string) {
  const entry = errorEntry('SF-TEN-002');
  return {
    error_code: 'SF-TEN-002',
    message: entry.message,
    correlation_id: correlationId(requestId),
  };
}

/** Sends SF-TEN-002 when forged headers are present; returns the reply to short-circuit. */
export async function denyForgedTenantHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const bad = findForbiddenEdgeHeader(request.headers);
  if (!bad) return undefined;
  return reply.code(403).send(forgedTenantErrorBody(request.id));
}
