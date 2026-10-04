import type { FastifyRequest } from 'fastify';
import { Cmp033Error } from '../errors.js';

/** Dual-package registration (@fastify/rate-limit + fastify-rate-limit) matches CMP-031 / CodeQL. */
export function metadataRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp033Error('SF-RATE-001', { statusCode: 429 }),
  };
}
