// @ts-check
/**
 * HTTP security headers for every Next.js surface (SECURITY.md: secure headers).
 * Plain ESM so next.config.ts can load it without a TypeScript loader.
 *
 * Callers may pass a per-request CSP nonce as the second argument. Without a nonce,
 * `'unsafe-inline'` remains for Next.js hydration (M00 G-04 residual until apps wire nonce).
 *
 * @param {boolean} development
 * @param {string} [nonce]
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(development, nonce) {
  const nonceOk =
    typeof nonce === 'string' &&
    nonce.length > 0 &&
    nonce.length <= 128 &&
    /^[A-Za-z0-9+/=_-]+$/.test(nonce);
  const script = nonceOk
    ? `'self' 'nonce-${nonce}'`
    : ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])].join(' ');
  const style = nonceOk ? `'self' 'nonce-${nonce}'` : "'self' 'unsafe-inline'";
  const csp = [
    "default-src 'self'",
    `script-src ${script}`,
    `style-src ${style}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  ];
}
