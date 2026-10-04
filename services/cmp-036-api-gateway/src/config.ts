export interface GatewayRateLimitConfig {
  /** Max requests per window per hashed client key. */
  max: number;
  /** Window length in milliseconds. */
  timeWindowMs: number;
}

export interface GatewayEdgeConfig {
  rateLimit: GatewayRateLimitConfig;
}

export const DEFAULT_GATEWAY_EDGE: GatewayEdgeConfig = {
  rateLimit: {
    max: 300,
    timeWindowMs: 60_000,
  },
};

export function gatewayRateLimitFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GatewayRateLimitConfig {
  const maxRaw = env['SF_GATEWAY_RATE_LIMIT_MAX'];
  const windowRaw = env['SF_GATEWAY_RATE_LIMIT_WINDOW_MS'];
  const max = maxRaw ? Number(maxRaw) : DEFAULT_GATEWAY_EDGE.rateLimit.max;
  const timeWindowMs = windowRaw ? Number(windowRaw) : DEFAULT_GATEWAY_EDGE.rateLimit.timeWindowMs;
  if (!Number.isInteger(max) || max < 1 || max > 1_000_000) {
    throw new Error('Invalid configuration for: SF_GATEWAY_RATE_LIMIT_MAX');
  }
  if (!Number.isInteger(timeWindowMs) || timeWindowMs < 100 || timeWindowMs > 3_600_000) {
    throw new Error('Invalid configuration for: SF_GATEWAY_RATE_LIMIT_WINDOW_MS');
  }
  return { max, timeWindowMs };
}
