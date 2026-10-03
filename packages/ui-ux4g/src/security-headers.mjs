// @ts-check
/**
 * HTTP security headers for every Next.js surface (SECURITY.md: secure headers).
 * Plain ESM so next.config.ts can load it without a TypeScript loader.
 * The M00 CSP allows inline scripts because Next.js hydration emits them; a nonce-based CSP
 * replaces this with the UX4G foundation in M03 (gap G-04).
 *
 * @param {boolean} development
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(development) {
  const script = ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])].join(' ');
  const csp = [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
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
