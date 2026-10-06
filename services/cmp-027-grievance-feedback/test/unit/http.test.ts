import { describe, expect, it } from 'vitest';
import { createGrievanceRoutes, errorResponse, registerGrievanceRoutes } from '../../src/http.js';
import { Cmp027Error } from '../../src/errors.js';
import { GrievanceFeedbackService } from '../../src/service.js';
import { assertNoTenantIdentifyingHeaders } from '../../src/context.js';
import { loadConfig, assertPortAllowed } from '../../src/config.js';
import { AllowLinkagePolicyPort } from '../../src/ports/external.js';
import { MemoryGrievanceStore } from '../doubles/memory-store.js';
import { harness, CITIZEN, ctx, key, T1 } from '../doubles/fixtures.js';

describe('CMP-027 HTTP and context', () => {
  it('refuses X-Tenant-ID and tenant-identifying headers', () => {
    expect(() => assertNoTenantIdentifyingHeaders({ 'x-tenant-id': T1 })).toThrow(Cmp027Error);
    expect(() => assertNoTenantIdentifyingHeaders({ 'X-Tenant-ID': T1 })).toThrow(Cmp027Error);
    expect(() => assertNoTenantIdentifyingHeaders({ forwarded: 'host=x;tenant=abc' })).toThrow(
      Cmp027Error,
    );
  });

  it('maps errors to frozen error-response shape and files via routes', async () => {
    const store = new MemoryGrievanceStore();
    const h = harness(store);
    const routes = createGrievanceRoutes({
      service: h.service,
      resolveContext: async () => ctx(T1, 'CITIZEN', CITIZEN),
    });
    const file = routes.find((r) => r.url === '/grievances');
    expect(file).toBeDefined();
    if (!file) throw new Error('missing file route');
    const res = await file.handle({
      headers: { 'idempotency-key': key('http-file') },
      body: {},
    });
    expect(res.status).toBe(201);
    const err = errorResponse(
      new Cmp027Error('SF-SYS-002'),
      '11111111-1111-4111-8111-111111111111',
    );
    expect(err.status).toBe(404);
    expect((err.body as { error_code: string }).error_code).toBe('SF-SYS-002');
  });

  it('simulated linkage is refused in PRODUCTION', () => {
    expect(loadConfig({ SF_ENVIRONMENT: 'LOCAL' }).environment).toBe('LOCAL');
    expect(() => assertPortAllowed(new AllowLinkagePolicyPort(), 'PRODUCTION', 'LINKAGE')).toThrow(
      Cmp027Error,
    );
  });

  it('registers Fastify-shaped routes and remaining GET/POST handlers', async () => {
    const store = new MemoryGrievanceStore();
    const h = harness(store);
    const registered: string[] = [];
    registerGrievanceRoutes(
      {
        route(options) {
          registered.push(`${options.method} ${options.url}`);
          return options;
        },
      },
      { service: h.service, resolveContext: async () => ctx(T1, 'CITIZEN', CITIZEN) },
    );
    expect(registered.length).toBe(7);
    const routes = createGrievanceRoutes({
      service: h.service,
      resolveContext: async () => ctx(T1, 'CITIZEN', CITIZEN),
    });
    const fileRoute = routes.find((r) => r.url === '/grievances');
    if (!fileRoute) throw new Error('missing file route');
    const filed = await fileRoute.handle({
      headers: { 'idempotency-key': key('http-file-2') },
      body: {},
    });
    const id = (filed.body as { grievance: { grievance_id: string } }).grievance.grievance_id;
    const get = routes.find((r) => r.url === '/grievances/:grievanceId');
    if (!get) throw new Error('missing get route');
    const got = await get.handle({
      headers: {},
      params: { grievanceId: id },
    });
    expect(got.status).toBe(200);
    const trans = routes.find((r) => r.url.endsWith('/transitions'));
    if (!trans) throw new Error('missing transitions route');
    expect((await trans.handle({ headers: {}, params: { grievanceId: id } })).status).toBe(200);
  });

  it('service constructor accepts explicit config', () => {
    const store = new MemoryGrievanceStore();
    const svc = new GrievanceFeedbackService({
      store,
      authorizer: {
        async decide() {
          return {
            allow: false,
            reason_code: 'DEFAULT_DENY',
            policy_revision: 'x',
            decision_id: '00000000-0000-4000-8000-000000000000',
          };
        },
      },
      config: { environment: 'CI' },
    });
    expect(svc).toBeInstanceOf(GrievanceFeedbackService);
  });
});
