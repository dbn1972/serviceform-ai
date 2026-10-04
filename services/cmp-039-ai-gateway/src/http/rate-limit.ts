import type { FastifyRequest } from 'fastify';
import { Cmp039Error } from '../errors.js';

export function aiGatewayRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp039Error('SF-RATE-001', { statusCode: 429 }),
  };
}
