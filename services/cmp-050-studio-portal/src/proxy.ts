import { Cmp050Error } from './errors.js';

const ALLOWED_PREFIXES = [
  'metadata/',
  'publication-requests',
  'tenant-service-bindings',
  'artifact-versions/',
  'categories',
  'canonical-services',
  'offerings',
  'admin/categories',
  'admin/canonical-services',
] as const;

export function assertPlatformPath(path: string): string {
  let i = 0;
  while (i < path.length && path[i] === '/') i += 1;
  const trimmed = path.slice(i);
  const relative = trimmed.startsWith('v1/') ? trimmed.slice(3) : trimmed;
  const ok = ALLOWED_PREFIXES.some(
    (prefix) => relative === prefix.replace(/\/$/, '') || relative.startsWith(prefix),
  );
  if (!ok) throw new Cmp050Error('SF-AUTH-002', { details: [{ code: 'PATH_NOT_ALLOWLISTED' }] });
  if (relative.includes('..') || relative.includes('//')) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'INVALID_PATH' }] });
  }
  return `/v1/${relative}`;
}

export type PlatformRequest = {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
};

export type PlatformResponse = { status: number; body: unknown };

export type PlatformTransport = {
  send: (req: PlatformRequest) => Promise<PlatformResponse>;
};

export function createHttpTransport(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
): PlatformTransport {
  return {
    async send(req) {
      if (!apiBaseUrl)
        throw new Cmp050Error('SF-SYS-004', { details: [{ code: 'API_UNAVAILABLE' }] });
      const path = assertPlatformPath(req.path);
      const headers: Record<string, string> = { accept: 'application/json' };
      if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
      if (req.body !== undefined) headers['content-type'] = 'application/json';
      const init: RequestInit = { method: req.method, headers };
      if (req.body !== undefined) init.body = JSON.stringify(req.body);
      const res = await fetchImpl(`${apiBaseUrl}${path}`, init);
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text.length === 0 ? {} : (JSON.parse(text) as unknown);
      } catch {
        parsed = { error_code: 'SF-SYS-001', message: 'Upstream returned non-JSON' };
      }
      return { status: res.status, body: parsed };
    },
  };
}
