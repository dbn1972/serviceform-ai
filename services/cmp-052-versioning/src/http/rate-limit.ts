import type { FastifyRequest } from 'fastify';
import { Cmp052Error } from '../errors.js';

export function versioningRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp052Error('SF-RATE-001', { statusCode: 429 }),
  };
}
