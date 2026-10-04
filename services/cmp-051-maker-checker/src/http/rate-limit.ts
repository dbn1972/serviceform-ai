import type { FastifyRequest } from 'fastify';
import { Cmp051Error } from '../errors.js';

export function makerCheckerRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp051Error('SF-RATE-001', { statusCode: 429 }),
  };
}
