import { describe, expect, it } from 'vitest';
import { assertNoTenantIdentifyingHeaders, requireTenantContext } from '../../src/context.js';
import { assertPortAllowed, loadConfig } from '../../src/config.js';
import { Cmp026Error, mapPgError } from '../../src/errors.js';
import {
  createMessagingRoutes,
  errorResponse,
  registerMessagingRoutes,
  type HttpRequestLike,
} from '../../src/http.js';
import { MessagingService } from '../../src/service.js';
import {
  SimulatedAttachmentStorage,
  SimulatedCaseParticipation,
} from '../../src/ports/simulated.js';
import { denyAllAuthorization } from '../../src/ports/authorization.js';
import { APP_1, CITIZEN, ctx, harness, key, KEY_OK, OFFICER, T1 } from '../doubles/fixtures.js';
import { MemoryMessagingStore } from '../doubles/memory-store.js';

describe('CMP-026 context headers', () => {
  it('refuses tenant-identifying and actor-asserting headers', () => {
    for (const headers of [
      { 'x-tenant-id': T1 },
      { 'X-Tenant-ID': T1 },
      { 'x-sf-tenant': T1 },
      { 'x-roles': 'ADMIN' },
      { forwarded: 'host=x;tenant=abc' },
    ]) {
      expect(() => assertNoTenantIdentifyingHeaders(headers)).toThrow(Cmp026Error);
    }
    expect(() => assertNoTenantIdentifyingHeaders({ 'idempotency-key': 'abc' })).not.toThrow();
    expect(() => assertNoTenantIdentifyingHeaders({ forwarded: ['for=1.2.3.4'] })).not.toThrow();
  });

  it('requires a valid tenant-bound request context', () => {
    expect(() => requireTenantContext(undefined)).toThrow(/Authentication/);
    expect(() => requireTenantContext({ tenant_id: 'x' })).toThrow(/Authentication/);
    expect(() => requireTenantContext({ ...ctx(T1, 'CITIZEN', CITIZEN), tenant_id: null })).toThrow(
      /Tenant context missing/,
    );
    expect(requireTenantContext(ctx(T1, 'CITIZEN', CITIZEN)).tenant_id).toBe(T1);
  });
});

describe('CMP-026 config and simulation policy', () => {
  it('rejects invalid environments and simulated ports outside simulation environments', () => {
    expect(loadConfig({}).environment).toBe('LOCAL');
    expect(loadConfig({ SF_ENVIRONMENT: 'SIT' }).environment).toBe('SIT');
    expect(() => loadConfig({ SF_ENVIRONMENT: 'MARS' })).toThrow(Cmp026Error);
    for (const env of ['PRODUCTION', 'UAT', 'PREPROD'] as const) {
      expect(() => assertPortAllowed(new SimulatedAttachmentStorage(), env, 'STORAGE')).toThrow(
        Cmp026Error,
      );
      expect(() =>
        assertPortAllowed(new SimulatedCaseParticipation(), env, 'PARTICIPATION'),
      ).toThrow(Cmp026Error);
    }
    expect(() =>
      assertPortAllowed(new SimulatedAttachmentStorage(), 'CI', 'STORAGE'),
    ).not.toThrow();
    expect(() => assertPortAllowed({}, 'PRODUCTION', 'STORAGE')).not.toThrow();
  });

  it('service construction fails closed when a simulated port is wired in PRODUCTION', () => {
    expect(
      () =>
        new MessagingService({
          store: new MemoryMessagingStore(),
          authorizer: denyAllAuthorization(),
          storage: new SimulatedAttachmentStorage(),
          config: { environment: 'PRODUCTION' },
        }),
    ).toThrow(Cmp026Error);
    expect(
      () =>
        new MessagingService({
          store: new MemoryMessagingStore(),
          authorizer: denyAllAuthorization(),
          participation: new SimulatedCaseParticipation(),
          config: { environment: 'PRODUCTION' },
        }),
    ).toThrow(Cmp026Error);
  });

  it('deny-all authorization fails closed', async () => {
    const out = await denyAllAuthorization().decide({
      subject: {
        user_id: CITIZEN,
        actor_type: 'CITIZEN',
        tenant_id: T1,
        roles: [],
        jurisdiction_ids: [],
      },
      resource: { resource_type: 'MessageThread', tenant_id: T1 },
      action: 'THREAD_READ',
    });
    expect(out.allow).toBe(false);
  });
});

describe('CMP-026 error mapping', () => {
  it('maps database hints and SQLSTATE codes to catalogue errors without leaking internals', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ code: 'P0001', hint: 'SF_THREAD_NOT_OPEN' }, 'SF-APP-001'],
      [{ code: 'P0001', hint: 'SF_NOT_PARTICIPANT' }, 'SF-AUTH-002'],
      [{ code: 'P0001', hint: 'SF_RECORD_IMMUTABLE' }, 'SF-SYS-003'],
      [{ code: 'P0001', hint: 'SF_INVALID_TRANSITION' }, 'SF-APP-001'],
      [{ code: '42501' }, 'SF-TEN-002'],
      [{ code: '23505' }, 'SF-APP-002'],
      [{ code: '23514' }, 'SF-APP-001'],
      [{ code: '23503' }, 'SF-SYS-002'],
      [{ code: '40001' }, 'SF-APP-001'],
      [{ code: '40P01' }, 'SF-APP-001'],
      [{ code: 'XX000', message: 'secret SQL text' }, 'SF-SYS-001'],
    ];
    for (const [err, code] of cases) {
      const mapped = mapPgError(err);
      expect(mapped.code).toBe(code);
      expect(JSON.stringify(errorResponse(mapped, T1).body)).not.toContain('secret SQL');
    }
    expect(mapPgError(new Cmp026Error('SF-SYS-002')).code).toBe('SF-SYS-002');
    expect(mapPgError(undefined).code).toBe('SF-SYS-001');
    expect(
      errorResponse(new Cmp026Error('SF-SYS-001', { details: [{ code: 'X' }] }), T1).body,
    ).not.toHaveProperty('details');
  });
});

describe('CMP-026 HTTP routes', () => {
  async function setup() {
    const store = new MemoryMessagingStore();
    const h = harness(store);
    let actor = ctx(T1, 'OFFICER', OFFICER);
    const routes = createMessagingRoutes({ service: h.service, resolveContext: async () => actor });
    const call = (method: string, url: string, req: Partial<HttpRequestLike> = {}) => {
      const route = routes.find((r) => r.method === method && r.url === url);
      if (!route) throw new Error(`no route ${method} ${url}`);
      return route.handle({ headers: { 'idempotency-key': key('http') }, ...req });
    };
    return { call, as: (c: typeof actor) => (actor = c), h, store };
  }

  it('drives the full thread lifecycle through the route table', async () => {
    const { call, as, store } = await setup();
    const opened = await call('POST', '/threads', {
      body: {
        application_id: APP_1,
        opener_role_code: 'CASE_OFFICER',
        participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
      },
    });
    expect(opened.status).toBe(201);
    const threadId = (opened.body as { thread: { thread_id: string } }).thread.thread_id;
    const params = { threadId };
    const sent = await call('POST', '/threads/:threadId/messages', {
      params,
      body: { body: 'hello', attachment_storage_keys: [KEY_OK] },
    });
    expect(sent.status).toBe(201);
    const msg = (
      sent.body as { message: { message_id: string; attachments: { attachment_id: string }[] } }
    ).message;
    const list = await call('GET', '/threads/:threadId/messages', {
      params,
      query: { limit: '10' },
    });
    expect(list.status).toBe(200);
    expect((await call('GET', '/threads/:threadId', { params })).status).toBe(200);
    expect((await call('GET', '/threads/:threadId/transitions', { params })).status).toBe(200);
    expect(
      (
        await call('GET', '/applications/:applicationId/threads', {
          params: { applicationId: APP_1 },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('GET', '/threads/:threadId/attachments/:attachmentId/access', {
          params: { ...params, attachmentId: msg.attachments[0]?.attachment_id },
        })
      ).status,
    ).toBe(200);
    expect(
      (await call('POST', '/threads/:threadId/read', { params, body: { up_to_sequence: 1 } }))
        .status,
    ).toBe(200);
    const added = await call('POST', '/threads/:threadId/participants', {
      params,
      body: { actor_id: '0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e', role_code: 'CASE_OFFICER' },
    });
    expect(added.status).toBe(201);
    const removed = await call('POST', '/threads/:threadId/participants/remove', {
      params,
      body: { actor_id: '0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e' },
    });
    expect(removed.status).toBe(200);
    const notice = await call('POST', '/threads/:threadId/messages', {
      params,
      body: { kind: 'OFFICIAL_NOTICE', body: 'notice', ack_required: true },
    });
    const noticeId = (notice.body as { message: { message_id: string } }).message.message_id;
    as(ctx(T1, 'CITIZEN', CITIZEN));
    const ack = await call('POST', '/threads/:threadId/messages/:messageId/acknowledge', {
      params: { ...params, messageId: noticeId },
    });
    expect(ack.status).toBe(201);
    const retract = await call('POST', '/threads/:threadId/messages/:messageId/retract', {
      params: { ...params, messageId: msg.message_id },
      body: {},
    });
    expect(retract.status).toBe(403);
    as(ctx(T1, 'OFFICER', OFFICER));
    const closed = await call('POST', '/threads/:threadId/commands', {
      params,
      body: { command: 'CLOSE', expected_status: 'OPEN', expected_version: 1 },
    });
    expect(closed.status).toBe(200);
    expect(store.state.threads.get(threadId)?.status).toBe('CLOSED');
  });

  it('replays idempotently with the idempotent-replayed header and maps errors', async () => {
    const { call } = await setup();
    const body = { application_id: APP_1, opener_role_code: 'CASE_OFFICER' };
    const headers = { 'idempotency-key': 'idem-http-replay-001' };
    const a = await call('POST', '/threads', { headers, body });
    const b = await call('POST', '/threads', { headers, body });
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body).toEqual(a.body);
    const missing = await call('POST', '/threads', { headers: {}, body });
    expect(missing.status).toBe(400);
    const notFound = await call('GET', '/threads/:threadId', {
      params: { threadId: '99999999-9999-4999-8999-999999999999' },
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body).toMatchObject({ error_code: 'SF-SYS-002' });
  });

  it('refuses tenant headers before resolving context and unauthenticated requests', async () => {
    const store = new MemoryMessagingStore();
    const h = harness(store);
    const routes = createMessagingRoutes({ service: h.service, resolveContext: async () => null });
    const open = routes.find((r) => r.url === '/threads' && r.method === 'POST');
    if (!open) throw new Error('missing');
    const spoof = await open.handle({ headers: { 'x-tenant-id': T1 }, body: {} });
    expect(spoof.status).toBe(403);
    expect(spoof.body).toMatchObject({ error_code: 'SF-TEN-002' });
    const anon = await open.handle({ headers: {}, body: {} });
    expect(anon.status).toBe(401);
  });

  it('registers Fastify-shaped routes', async () => {
    const h = harness(new MemoryMessagingStore());
    const registered: {
      method: string;
      url: string;
      handler: (r: HttpRequestLike, reply: unknown) => Promise<unknown>;
    }[] = [];
    registerMessagingRoutes(
      {
        route(options) {
          registered.push(options as never);
          return options;
        },
      },
      { service: h.service, resolveContext: async () => ctx(T1, 'OFFICER', OFFICER) },
    );
    expect(registered).toHaveLength(13);
    const sent: { code?: number; headers: Record<string, string>; payload?: unknown } = {
      headers: {},
    };
    const reply = {
      code(n: number) {
        sent.code = n;
        return reply;
      },
      header(k: string, v: string) {
        sent.headers[k] = v;
        return reply;
      },
      send(p?: unknown) {
        sent.payload = p;
        return p;
      },
    };
    const open = registered.find((r) => r.url === '/threads' && r.method === 'POST');
    await open?.handler(
      {
        headers: { 'idempotency-key': 'idem-fastify-0001' },
        body: { application_id: APP_1, opener_role_code: 'CASE_OFFICER' },
      },
      reply,
    );
    expect(sent.code).toBe(201);
    expect(sent.headers['content-type']).toBe('application/json');
  });
});
