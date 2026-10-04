import type { FastifyRequest } from 'fastify';
import { Cmp004Error } from '../errors.js';

/** Dual-package registration (@fastify/rate-limit + fastify-rate-limit) matches CMP-032 / CodeQL. */
export function identityRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: () => new Cmp004Error('SF-RATE-001', { statusCode: 429 }),
  };
}

export const DEFAULT_IDENTITY_RATE_LIMIT_MAX = 60;
export const DEFAULT_IDENTITY_RATE_LIMIT_WINDOW_MS = 60_000;
