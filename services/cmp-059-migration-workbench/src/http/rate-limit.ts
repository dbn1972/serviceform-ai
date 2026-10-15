import type { RateLimitPluginOptions } from '@fastify/rate-limit';

export function migrationRateLimitOptions(
  max: number,
  timeWindow: number,
): RateLimitPluginOptions {
  return {
    max,
    timeWindow,
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  };
}
