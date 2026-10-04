import type { FastifyRequest } from 'fastify';
import { SecurityError } from '../errors.js';

/**
 * In-process limiter for PEP authorization hooks.
 * Platform-wide HTTP quotas (per tenant/IP/credential) belong at the API edge
 * (CMP-036 / M00). This is the smallest CMP-048-owned bound so authz handlers
 * are not an unbounded login-oracle.
 */
export interface AuthzRateLimitConfig {
  windowMs: number;
  max: number;
}

const admitted = new WeakSet<object>();

export class AuthzRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly cfg: AuthzRateLimitConfig) {
    if (cfg.windowMs < 1 || cfg.max < 1) throw new Error('authz rate limit config invalid');
  }

  consume(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.cfg.windowMs;
    const prev = this.hits.get(key) ?? [];
    const kept = prev.filter((t) => t > cutoff);
    if (kept.length >= this.cfg.max) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }
}

export function authorizationRateLimitKey(req: FastifyRequest): string {
  const ip = req.ip || 'unknown';
  const url = req.routeOptions.url ?? req.url;
  return `${ip}\n${req.method}\n${url}`;
}

/** Named for CodeQL js/missing-rate-limiting: both PEP hooks must call this. */
export function rateLimitAuthorization(req: FastifyRequest, limiter: AuthzRateLimiter): void {
  if (admitted.has(req)) return;
  if (!limiter.consume(authorizationRateLimitKey(req))) {
    throw new SecurityError('SF-RATE-001', { statusCode: 429 });
  }
  admitted.add(req);
}

export const defaultAuthzRateLimit: AuthzRateLimitConfig = { windowMs: 60_000, max: 120 };
