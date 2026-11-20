import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { parseTrustedProxyHops, resolveTrustProxy } from '../src/trust-proxy.js';

describe('ADR-0008 / SEC F-08 trusted proxy hops', () => {
  it('defaults to no trust when SF_TRUSTED_PROXY_HOPS is unset', () => {
    const config = loadConfig({ SF_ENVIRONMENT: 'CI' });
    expect(config.trustProxy).toBe(false);
    expect(parseTrustedProxyHops(undefined)).toEqual([]);
    expect(resolveTrustProxy([], 'LOCAL')).toBe(false);
  });

  it('accepts a single BFF hop and a list of hops', () => {
    expect(loadConfig({ SF_ENVIRONMENT: 'CI', SF_TRUSTED_PROXY_HOPS: '10.0.0.5' }).trustProxy).toBe(
      '10.0.0.5',
    );
    expect(
      loadConfig({
        SF_ENVIRONMENT: 'LOCAL',
        SF_TRUSTED_PROXY_HOPS: '127.0.0.1, ::1',
      }).trustProxy,
    ).toEqual(['127.0.0.1', '::1']);
  });

  it('refuses world trust and PRODUCTION loopback-only', () => {
    expect(() => loadConfig({ SF_ENVIRONMENT: 'CI', SF_TRUSTED_PROXY_HOPS: '0.0.0.0/0' })).toThrow(
      /SF_TRUSTED_PROXY_HOPS/,
    );
    expect(() => loadConfig({ SF_ENVIRONMENT: 'CI', SF_TRUSTED_PROXY_HOPS: '*' })).toThrow(
      /SF_TRUSTED_PROXY_HOPS/,
    );
    expect(() =>
      loadConfig({
        SF_ENVIRONMENT: 'PRODUCTION',
        DATABASE_URL: 'postgres://ci@localhost:5432/sf',
        SF_TRUSTED_PROXY_HOPS: '127.0.0.1,::1',
      }),
    ).toThrow(/loopback-only/);
  });
});
