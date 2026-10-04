import type { FastifyRequest } from 'fastify';
import { Cmp009Error } from '../errors.js';

export function formsRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp009Error('SF-RATE-001', { statusCode: 429 }),
  };
}
