import { errorEntry } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';

export function auditRateLimitOptions(max: number, timeWindow: number) {
  return {
    global: true,
    max,
    timeWindow,
    ipv6Subnet: 64,
    hook: 'onRequest' as const,
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: (request: FastifyRequest) => {
      const entry = errorEntry('SF-RATE-001');
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        error_code: 'SF-RATE-001',
        message: entry.message,
        correlation_id: request.id,
      };
    },
  };
}

export function auditRouteRateLimitConfig(
  max: number,
  timeWindow: number,
): { config: { rateLimit: { max: number; timeWindow: number } } } {
  return { config: { rateLimit: { max, timeWindow } } };
}
