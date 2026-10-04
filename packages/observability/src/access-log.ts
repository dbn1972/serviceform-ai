/**
 * Access-log URL sanitisation (G-10 / Constitution #21).
 * Query strings and fragments must not appear in logs — they may carry personal data.
 */

/** Returns the path only; strips `?query` and `#fragment`. */
export function sanitizeUrlForLog(url: string): string {
  if (!url) return '/';
  let end = url.length;
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  const path = url.slice(0, end);
  return path.length > 0 ? path : '/';
}

/** Safe subset of an inbound HTTP request for structured access logs. */
export function sanitizeRequestForLog(req: {
  id?: unknown;
  method?: unknown;
  url?: unknown;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof req.method === 'string') out['method'] = req.method;
  if (typeof req.url === 'string') out['url'] = sanitizeUrlForLog(req.url);
  if (typeof req.id === 'string') out['id'] = req.id;
  return out;
}
