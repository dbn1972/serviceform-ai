const BASE = 'http://workbench.invalid';

/**
 * Same-origin post-sign-in destinations only. The target is resolved before its origin is
 * compared, and the resolved path must not be protocol-relative (`/.//host` collapses to `//host`).
 */
export function safeNext(raw: string | undefined, fallback = '/applications'): string {
  if (!raw || !raw.startsWith('/')) return fallback;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || url.pathname.startsWith('//')) return fallback;
  return `${url.pathname}${url.search}`;
}
