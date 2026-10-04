import { describe, expect, it } from 'vitest';
import { createGuardedFetch, SsrfBlockedError } from '../src/index.js';

describe('guardedFetch SSRF (005-28)', () => {
  const fetchFn = (async () => new Response('ok')) as typeof fetch;

  it('blocks private, link-local, loopback, schemes and off-allowlist hosts', async () => {
    const g = createGuardedFetch({
      allowlist: ['example.test'],
      fetchFn,
      lookupFn: async () => ({ address: '93.184.216.34', family: 4 }),
    });
    await expect(g('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('http://169.254.169.254/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('http://10.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('http://192.168.1.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('http://172.16.1.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('gopher://example.test/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('http://evil.test/')).rejects.toBeInstanceOf(SsrfBlockedError);
    const blockedLookup = createGuardedFetch({
      allowlist: ['example.test'],
      fetchFn,
      lookupFn: async () => ({ address: '127.0.0.1', family: 4 }),
    });
    await expect(blockedLookup('http://example.test/')).rejects.toBeInstanceOf(SsrfBlockedError);
    const ok = createGuardedFetch({
      allowlist: ['example.test'],
      fetchFn,
      lookupFn: async () => ({ address: '93.184.216.34', family: 4 }),
    });
    const res = await ok('https://example.test/v1');
    expect(res.ok).toBe(true);
    await expect(ok('not a url')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('http://[::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(g('http://172.31.1.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    const mapped = createGuardedFetch({
      allowlist: ['::ffff:127.0.0.1'],
      fetchFn,
      lookupFn: async () => ({ address: '127.0.0.1', family: 4 }),
    });
    await expect(mapped('http://::ffff:127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
