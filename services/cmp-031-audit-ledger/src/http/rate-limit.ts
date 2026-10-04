import type { FastifyRequest } from 'fastify';
import { AuditError } from '../domain/errors.js';

export function auditRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new AuditError('SF-RATE-001', { statusCode: 429 }),
  };
}
