import type { FastifyRequest } from 'fastify';
import { Cmp011Error } from '../errors.js';

export function evidenceRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp011Error('SF-RATE-001', { statusCode: 429 }),
  };
}
