import type { FastifyRequest } from 'fastify';
import { Cmp005Error } from '../errors.js';

/** Dual-package registration (@fastify/rate-limit + fastify-rate-limit) matches CMP-032 / CodeQL. */
export function profileRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp005Error('SF-RATE-001', { statusCode: 429 }),
  };
}
