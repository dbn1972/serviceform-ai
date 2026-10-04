import type { FastifyRequest } from 'fastify';
import { Cmp008Error } from '../errors.js';

export function rulesRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp008Error('SF-RATE-001', { statusCode: 429 }),
  };
}
