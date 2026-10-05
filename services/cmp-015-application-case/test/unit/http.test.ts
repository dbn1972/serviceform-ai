import { beforeEach, describe, expect, it } from 'vitest';
import { assertPortAllowed, loadConfig } from '../../src/config.js';
import { isForbiddenHeaderName } from '../../src/context.js';
import { Cmp015Error, mapPgError } from '../../src/errors.js';
import {
  createApplicationCaseRoutes,
  errorResponse,
  registerApplicationCaseRoutes,
  type HttpRequestLike,
  type ReplyLike,
  type RouteDefinition,
} from '../../src/http.js';
import {
  DenyPublishedBindingPort,
  SimulatedPublishedBindingPort,
} from '../../src/ports/published-binding.js';
import { DenyServicePolicyPort } from '../../src/ports/service-policy.js';
import { denyAllAuthorization } from '../../src/ports/authorization.js';
import { OutboxOnlyWorkflowAdvance } from '../../src/ports/workflow-advance.js';
import { ApplicationCaseService } from '../../src/service.js';
import {
  CANARY,
  CITIZEN,
  ctx,
  harness,
  key,
  OFFICER,
  T1,
  T2,
  TSB_T1,
  type Harness,
} from '../doubles/fixtures.js';
import { MemoryCaseStore } from '../doubles/memory-store.js';

const tokens = new Map<string, unknown>();
const resolveContext = async (r: HttpRequestLike) => {
  const auth = r.headers['authorization'];
  return typeof auth === 'string' ? (tokens.get(auth) ?? null) : null;
};

let h: Harness;
let routes: RouteDefinition[];
let store: MemoryCaseStore;

function route(method: string, url: string): RouteDefinition {
  const r = routes.find((x) => x.method === method && x.url === url);
  if (!r) throw new Error(`${method} ${url}`);
  return r;
}

beforeEach(() => {
  tokens.clear();
  tokens.set('t1-citizen', ctx(T1, 'CITIZEN', CITIZEN));
  tokens.set('t1-officer', ctx(T1, 'OFFICER', OFFICER));
  tokens.set('t2-officer', ctx(T2, 'OFFICER', OFFICER));
  store = new MemoryCaseStore();
  h = harness(store);
  routes = createApplicationCaseRoutes({ service: h.service, resolveContext });
});

async function create(): Promise<string> {
  const res = await route('POST', '/applications').handle({
    headers: { authorization: 't1-citizen', 'idempotency-key': key() },
    body: { tenant_service_binding_id: TSB_T1 },
  });
  expect(res.status).toBe(201);
  return (res.body as { application: { application_id: string } }).application.application_id;
}

describe('CMP-015 HTTP surface (contracts/openapi.json)', () => {
  it('exposes exactly the documented routes', () => {
    expect(routes.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /applications',
      'GET /applications/:applicationId',
      'GET /applications/:applicationId/transitions',
      'POST /applications/:applicationId/commands',
      'POST /applications/:applicationId/requests',
      'POST /applications/:applicationId/requests/:requestId/status',
    ]);
  });

  it('runs create -> command -> read -> request flows and marks idempotent replays', async () => {
    const id = await create();
    const cmdKey = key();
    const cmd = {
      headers: { authorization: 't1-citizen', 'idempotency-key': [cmdKey] },
      params: { applicationId: id },
      body: { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 },
    };
    const first = await route('POST', '/applications/:applicationId/commands').handle(cmd);
    expect(first.status).toBe(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const again = await route('POST', '/applications/:applicationId/commands').handle(cmd);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const read = await route('GET', '/applications/:applicationId').handle({
      headers: { authorization: 't1-officer' },
      params: { applicationId: id },
    });
    expect((read.body as { application: { state: string } }).application.state).toBe(
      'READY_TO_SUBMIT',
    );
    const list = await route('GET', '/applications/:applicationId/transitions').handle({
      headers: { authorization: 't1-officer' },
      params: { applicationId: id },
    });
    expect(list.status).toBe(200);
    const req = await route('POST', '/applications/:applicationId/requests').handle({
      headers: { authorization: 't1-citizen', 'idempotency-key': key() },
      params: { applicationId: id },
      body: { kind: 'WITHDRAWAL' },
    });
    expect(req.status).toBe(201);
    const rid = (req.body as { request: { request_id: string } }).request.request_id;
    const st = await route(
      'POST',
      '/applications/:applicationId/requests/:requestId/status',
    ).handle({
      headers: { authorization: 't1-officer', 'idempotency-key': key() },
      params: { applicationId: id, requestId: rid },
      body: { status: 'UNDER_REVIEW', expected_status: 'SUBMITTED' },
    });
    expect(st.status).toBe(200);
  });

  it('NEGATIVE: tenant-identifying headers are refused with SF-TEN-002 before any work', async () => {
    for (const name of ['x-tenant-id', 'X-SF-Tenant', 'x-roles', 'x-actor-id']) {
      const res = await route('POST', '/applications').handle({
        headers: { authorization: 't1-citizen', 'idempotency-key': key(), [name]: T2 },
        body: { tenant_service_binding_id: TSB_T1 },
      });
      expect(res.status).toBe(403);
      expect((res.body as { error_code: string }).error_code).toBe('SF-TEN-002');
    }
    const fwd = await route('GET', '/applications/:applicationId').handle({
      headers: { authorization: 't1-citizen', forwarded: ['for=1.2.3.4;tenant=x'] },
      params: { applicationId: CANARY },
    });
    expect(fwd.status).toBe(403);
    expect(store.state.cases.size).toBe(0);
    expect(isForbiddenHeaderName('content-type')).toBe(false);
  });

  it('NEGATIVE: wrong tenant gets 404 with no case data (CROSS_TENANT_LEAKAGE=0)', async () => {
    const id = await create();
    const res = await route('GET', '/applications/:applicationId').handle({
      headers: { authorization: 't2-officer' },
      params: { applicationId: id },
    });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(id);
    expect(JSON.stringify(res.body)).not.toContain(T1);
  });

  it('maps errors to SF-CON-ERROR-RESPONSE and hides details of 5xx', async () => {
    const unauth = await route('POST', '/applications').handle({ headers: {}, body: {} });
    expect(unauth.status).toBe(401);
    expect(unauth.body).toMatchObject({ error_code: 'SF-AUTH-001' });
    const bad = await route('POST', '/applications').handle({
      headers: { authorization: 't1-citizen' },
      body: {},
    });
    expect(bad.body).toMatchObject({
      error_code: 'SF-SYS-003',
      details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }],
    });
    const sys = errorResponse(
      new Cmp015Error('SF-SYS-001', { details: [{ code: 'INTERNAL' }] }),
      CANARY,
    );
    expect(sys.body).toEqual({
      error_code: 'SF-SYS-001',
      message: 'Unexpected server error',
      correlation_id: CANARY,
    });
    expect(errorResponse(new Error('boom'), CANARY).status).toBe(500);
  });

  it('registers on a Fastify-shaped registrar and replies through it', async () => {
    const registered: {
      method: string;
      url: string;
      handler: (r: HttpRequestLike, reply: ReplyLike) => Promise<unknown>;
    }[] = [];
    const list = registerApplicationCaseRoutes(
      { route: (o) => registered.push(o) },
      { service: h.service, resolveContext },
    );
    expect(list).toHaveLength(6);
    const sent: { code?: number; headers: Record<string, string>; body?: unknown } = {
      headers: {},
    };
    const reply: ReplyLike = {
      code(c) {
        sent.code = c;
        return reply;
      },
      header(n, v) {
        sent.headers[n] = v;
        return reply;
      },
      send(b) {
        sent.body = b;
        return b;
      },
    };
    await registered[1]?.handler(
      { headers: { authorization: 't1-citizen' }, params: { applicationId: CANARY } },
      reply,
    );
    expect(sent.code).toBe(404);
    expect(sent.headers['content-type']).toBe('application/json');
  });

  it('missing params resolve to validation errors', async () => {
    const res = await route('GET', '/applications/:applicationId').handle({
      headers: { authorization: 't1-citizen' },
    });
    expect(res.status).toBe(400);
  });
});

describe('configuration and port mode guards (Constitution #22; INT-013)', () => {
  it('loads SF_ENVIRONMENT and refuses unknown values', () => {
    expect(loadConfig({}).environment).toBe('LOCAL');
    expect(loadConfig({ SF_ENVIRONMENT: 'PRODUCTION' }).environment).toBe('PRODUCTION');
    expect(() => loadConfig({ SF_ENVIRONMENT: 'MARS' })).toThrow(Cmp015Error);
  });

  it('refuses SIMULATED ports in PRODUCTION and non-simulation environments', () => {
    const sim = new SimulatedPublishedBindingPort();
    expect(() => assertPortAllowed(sim, 'PRODUCTION', 'BINDINGS')).toThrow(
      /Request validation failed/,
    );
    expect(() => assertPortAllowed(sim, 'UAT', 'BINDINGS')).toThrow(Cmp015Error);
    expect(() => assertPortAllowed(sim, 'CI', 'BINDINGS')).not.toThrow();
    expect(() =>
      assertPortAllowed(new DenyPublishedBindingPort(), 'PRODUCTION', 'BINDINGS'),
    ).not.toThrow();
    expect(
      () =>
        new ApplicationCaseService({
          store: new MemoryCaseStore(),
          authorizer: denyAllAuthorization(),
          bindings: sim,
          servicePolicy: new DenyServicePolicyPort(),
          config: { environment: 'PRODUCTION' },
        }),
    ).toThrow(Cmp015Error);
  });

  it('defaults are fail-closed (deny authz, no binding, deny policy, outbox-only workflow)', async () => {
    const svc = new ApplicationCaseService({
      store: new MemoryCaseStore(),
      authorizer: denyAllAuthorization(),
      bindings: new DenyPublishedBindingPort(),
      servicePolicy: new DenyServicePolicyPort(),
    });
    expect(svc.config.environment).toBeDefined();
    await expect(
      svc.createDraft(ctx(T1, 'CITIZEN', CITIZEN), { tenant_service_binding_id: TSB_T1 }, key()),
    ).rejects.toMatchObject({
      code: 'SF-FORM-001',
    });
    expect(await new DenyServicePolicyPort().evaluateTransition()).toEqual({
      permitted: false,
      policy_ref: 'unconfigured',
    });
    expect(await new OutboxOnlyWorkflowAdvance().advance()).toBeUndefined();
    expect((await denyAllAuthorization().decide({} as never)).allow).toBe(false);
  });
});

describe('PostgreSQL error mapping (no SQL text leakage)', () => {
  it.each([
    [{ code: 'P0001', hint: 'SF_INVALID_TRANSITION' }, 'SF-APP-001'],
    [{ code: 'P0001', hint: 'SF_REQUEST_NOT_COMMITTED' }, 'SF-APP-001'],
    [{ code: 'P0001', hint: 'SF_PIN_IMMUTABLE' }, 'SF-APP-001'],
    [{ code: 'P0001', hint: 'SF_RECORD_IMMUTABLE' }, 'SF-SYS-003'],
    [{ code: 'P0001', hint: 'OTHER' }, 'SF-SYS-001'],
    [{ code: '42501' }, 'SF-TEN-002'],
    [{ code: '23505' }, 'SF-APP-002'],
    [{ code: '23514' }, 'SF-APP-001'],
    [{ code: '23503' }, 'SF-SYS-002'],
    [{ code: '40001' }, 'SF-APP-001'],
    [null, 'SF-SYS-001'],
  ])('%j -> %s', (err, code) => {
    expect(mapPgError(err).code).toBe(code);
  });
});
