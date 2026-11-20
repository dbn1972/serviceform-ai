/**
 * Trusted-proxy hop resolution for Fastify `trustProxy` (ADR-0008 / SEC F-08).
 *
 * Default is no trust: `request.ip` is the TCP peer (typically the portal BFF), so
 * client-supplied `X-Forwarded-For` cannot rotate rate-limit buckets.
 *
 * Operators may list the BFF hop(s) in `SF_TRUSTED_PROXY_HOPS` (comma-separated IPs or
 * CIDRs). PRODUCTION must not trust the world or loopback-only; SAMPLE_LAB/LOCAL may use
 * `127.0.0.1,::1` when the BFF and host share a machine.
 */

const WORLD = new Set(['*', 'true', '0.0.0.0/0', '::/0', '0.0.0.0', '::']);
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export type TrustProxyOption = false | string | string[];

export function parseTrustedProxyHops(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}

/**
 * Resolves Fastify `trustProxy` from configured hops.
 * @throws when hops trust the world, or PRODUCTION is loopback-only
 */
export function resolveTrustProxy(hops: string[], environment: string): TrustProxyOption {
  if (hops.length === 0) return false;
  for (const hop of hops) {
    const lower = hop.toLowerCase();
    if (WORLD.has(lower)) {
      throw new Error(
        'Invalid configuration for: SF_TRUSTED_PROXY_HOPS (must not trust the world)',
      );
    }
  }
  if (environment === 'PRODUCTION' && hops.every((hop) => LOOPBACK.has(hop.toLowerCase()))) {
    throw new Error(
      'Invalid configuration for: SF_TRUSTED_PROXY_HOPS (PRODUCTION must not be loopback-only)',
    );
  }
  return hops.length === 1 ? hops[0]! : hops;
}
