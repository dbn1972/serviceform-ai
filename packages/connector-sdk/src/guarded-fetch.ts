import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { assertNoOpenTransaction } from './no-txn-guard.js';
import { SsrfBlockedError } from './errors.js';

export interface GuardedFetchOptions {
  allowlist: readonly string[];
  lookupFn?: (hostname: string) => Promise<LookupAddress>;
  fetchFn?: typeof fetch;
}

const BLOCKED_SCHEMES = new Set(['file:', 'gopher:', 'ftp:', 'data:', 'javascript:']);

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map((x) => Number(x));
  return ((p[0] ?? 0) << 24) + ((p[1] ?? 0) << 16) + ((p[2] ?? 0) << 8) + (p[3] ?? 0);
}

function isBlockedIp(ip: string): boolean {
  if (ip === '::1' || ip === '::' || ip.startsWith('fd') || ip.toLowerCase().startsWith('fe80:'))
    return true;
  if (ip.startsWith('::ffff:')) return isBlockedIp(ip.slice(7));
  if (!isIP(ip)) return true;
  if (isIP(ip) === 6) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
  }
  const n = ipv4ToInt(ip) >>> 0;
  const inRange = (start: string, bits: number) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(start) & mask);
  };
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.168.0.0', 16) ||
    inRange('255.255.255.255', 32)
  );
}

export function createGuardedFetch(
  opts: GuardedFetchOptions,
): (url: string, init?: RequestInit) => Promise<Response> {
  const lookupFn = opts.lookupFn ?? ((hostname: string) => lookup(hostname));
  const fetchFn = opts.fetchFn ?? fetch;
  const allow = new Set(opts.allowlist.map((h) => h.toLowerCase()));

  return async (url, init) => {
    assertNoOpenTransaction();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SsrfBlockedError('Invalid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new SsrfBlockedError('Scheme is not allowed');
    }
    if (BLOCKED_SCHEMES.has(parsed.protocol)) throw new SsrfBlockedError('Scheme is not allowed');
    const host = parsed.hostname.toLowerCase();
    if (!allow.has(host)) throw new SsrfBlockedError('Host is not on the allowlist');
    if (isIP(host) && isBlockedIp(host)) throw new SsrfBlockedError('Target address is blocked');
    const resolved = isIP(host) ? host : (await lookupFn(host)).address;
    if (isBlockedIp(resolved)) throw new SsrfBlockedError('Resolved address is blocked');
    const response = await fetchFn(url, { ...init, redirect: 'error' });
    return response;
  };
}
