import { Cmp050Error } from './errors.js';

const ROLE_ACTOR_HEADERS = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('tenant')) return true;
  if (n.startsWith('x-sf-')) return true;
  return ROLE_ACTOR_HEADERS.has(n);
}

export function assertNoTenantIdentifyingHeaders(
  headers:
    | Record<string, string | string[] | undefined>
    | { forEach: (cb: (value: string, key: string) => void) => void },
): void {
  const entries: Array<[string, string]> = [];
  if (
    'forEach' in headers &&
    typeof headers.forEach === 'function' &&
    !Object.prototype.hasOwnProperty.call(headers, 'forEach')
  ) {
    headers.forEach((value, key) => {
      entries.push([key, value]);
    });
  } else {
    for (const [key, raw] of Object.entries(
      headers as Record<string, string | string[] | undefined>,
    )) {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      entries.push([key, text]);
    }
  }
  for (const [name, value] of entries) {
    if (isForbiddenHeaderName(name)) throw new Cmp050Error('SF-TEN-002');
    if (name.toLowerCase() === 'forwarded' && /(?:^|;|\s)tenant\s*=/i.test(value)) {
      throw new Cmp050Error('SF-TEN-002');
    }
  }
}
