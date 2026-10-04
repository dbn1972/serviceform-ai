import { createHash } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { errorEntry } from '@serviceform/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { GatewayRateLimitConfig } from './config.js';

function clientKey(req: FastifyRequest): string {
  // Hash the connection identifier so raw network addresses never become log fields.
  const raw = req.ip || 'unknown';
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function isProbe(url: string): boolean {
  return url.startsWith('/health/');
}

export interface EdgeRateLimitOptions {
  rateLimit: GatewayRateLimitConfig;
}

/**
 * Platform edge quota (CMP-036). Component PEP / route limiters remain in CMP-048 / CMP-031;
 * this bound protects the host from abuse spikes without owning domain authorization.
 */
export const edgeRateLimitPlugin = fp(
  async (app: FastifyInstance, opts: EdgeRateLimitOptions) => {
    const entry = errorEntry('SF-RATE-001');
    await app.register(rateLimit, {
      global: true,
      hook: 'onRequest',
      max: opts.rateLimit.max,
      timeWindow: opts.rateLimit.timeWindowMs,
      keyGenerator: clientKey,
      allowList: (req) => isProbe(req.url),
      addHeaders: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
        'retry-after': true,
      },
      addHeadersOnExceeding: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
      },
      errorResponseBuilder: (_req, context) => {
        // Must return an Error with statusCode; the host error handler maps to SF-RATE-001.
        const err = new Error(entry.message) as Error & { statusCode: number; code: string };
        err.statusCode = context.statusCode;
        err.code = 'SF-RATE-001';
        return err;
      },
    });
  },
  { name: 'cmp-036-edge-rate-limit', fastify: '5.x' },
);
