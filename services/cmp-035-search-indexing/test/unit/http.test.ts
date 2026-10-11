import { describe, expect, it } from 'vitest';
import { Cmp035Error } from '../../src/errors.js';
import {
  createSearchRoutes,
  errorResponse,
  registerSearchRoutes,
  type HttpRequestLike,
  type ReplyLike,
  type RouteDefinition,
} from '../../src/http.js';
import { SearchQueryService } from '../../src/service.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { ctx, T1 } from '../doubles/fixtures.js';
import { MemorySearchStore } from '../doubles/memory-store.js';

function routes(resolved: unknown = ctx(T1)): RouteDefinition[] {
  const service = new SearchQueryService({
    store: new MemorySearchStore(),
    authorizer: new ContractAuthorizer(),
    config: { environment: 'CI' },
  });
  return createSearchRoutes({ service, resolveContext: async () => resolved });
}

function route(rs: RouteDefinition[], method: string, url: string): RouteDefinition {
  const r = rs.find((x) => x.method === method && x.url === url);
  if (!r) throw new Error(`no route ${method} ${url}`);
  return r;
}

describe('CMP-035 HTTP surface', () => {
  it('serves queries with no-store caching and echoes the context correlation id on errors', async () => {
    const c = ctx(T1);
    const rs = routes(c);
    const ok = await route(rs, 'POST', '/search/queries').handle({ headers: {}, body: {} });
    expect(ok).toEqual({
      status: 200,
      body: { hits: [], next_cursor: null },
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
    const bad = await route(rs, 'POST', '/search/queries').handle({
      headers: {},
      body: { limit: 0 },
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error_code: 'SF-SYS-003', correlation_id: c.correlation_id });
    const missing = await route(rs, 'GET', '/search/documents/:documentId').handle({
      headers: {},
      params: { documentId: T1 },
    });
    expect(missing.status).toBe(404);
  });

  it.each([
    [{ 'x-tenant-id': T1 }],
    [{ 'X-SF-Tenant': T1 }],
    [{ 'x-roles': 'ADMIN' }],
    [{ forwarded: 'for=1.2.3.4;tenant=abc' }],
    [{ forwarded: ['proto=https', 'tenant=abc'] }],
  ])('rejects tenant-identifying headers %j with SF-TEN-002', async (headers) => {
    const res = await route(routes(), 'POST', '/search/queries').handle({ headers, body: {} });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error_code: 'SF-TEN-002' });
  });

  it('allows an ordinary forwarded header', async () => {
    const res = await route(routes(), 'POST', '/search/queries').handle({
      headers: { forwarded: 'for=1.2.3.4', accept: undefined },
      body: {},
    });
    expect(res.status).toBe(200);
  });

  it('maps a missing context to SF-AUTH-001 and unknown errors to a detail-free 500', async () => {
    const res = await route(routes(null), 'GET', '/search/documents/:documentId').handle({
      headers: {},
      params: 'not-an-object',
    } as HttpRequestLike);
    expect(res.status).toBe(401);
    const boom = errorResponse(new Error('db exploded'), T1);
    expect(boom).toEqual({
      status: 500,
      body: { error_code: 'SF-SYS-001', message: 'Unexpected server error', correlation_id: T1 },
      headers: { 'content-type': 'application/json' },
    });
    const detailed = errorResponse(new Cmp035Error('SF-SYS-001', { details: [{ code: 'X' }] }), T1);
    expect(detailed.body).not.toHaveProperty('details');
  });

  it('registers routes on a host registrar', async () => {
    const registered: {
      method: string;
      url: string;
      handler: (r: HttpRequestLike, reply: ReplyLike) => Promise<unknown>;
    }[] = [];
    const service = new SearchQueryService({
      store: new MemorySearchStore(),
      authorizer: new ContractAuthorizer(),
      config: { environment: 'CI' },
    });
    registerSearchRoutes(
      { route: (o) => registered.push(o) },
      { service, resolveContext: async () => ctx(T1) },
    );
    expect(registered.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /search/queries',
      'GET /search/documents/:documentId',
    ]);
    const sent: unknown[] = [];
    const headers: Record<string, string> = {};
    let code = 0;
    const reply: ReplyLike = {
      code(c) {
        code = c;
        return reply;
      },
      header(n, v) {
        headers[n] = v;
        return reply;
      },
      send(p) {
        sent.push(p);
        return p;
      },
    };
    await registered[0]?.handler({ headers: {}, body: {} }, reply);
    expect(code).toBe(200);
    expect(headers['cache-control']).toBe('no-store');
    expect(sent).toEqual([{ hits: [], next_cursor: null }]);
  });
});
