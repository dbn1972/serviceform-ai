import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from '../doubles/harness.js';
import {
  ACTOR_CITIZEN,
  BINDING_EMAIL,
  BINDING_SMS,
  CANARY_ADDRESS,
  ctxFor,
  DISPATCH_BODY,
  integrationCtx,
  realBinding,
  simulatedBinding,
  TEMPLATE_BODY,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function publish(h: Harness, over: Record<string, unknown> = {}): Promise<Body> {
  const r = await h.call('POST', '/v1/notification-templates', { ...TEMPLATE_BODY, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as Body;
}

async function dispatch(h: Harness, over: Record<string, unknown> = {}, key?: string) {
  return h.call('POST', '/v1/notifications', { ...DISPATCH_BODY, ...over }, key ? { key } : {});
}

describe('template publication', () => {
  it('publishes immutable monotonically increasing versions per (ref, channel, locale)', async () => {
    const h = makeHarness();
    expect((await publish(h)).template_version).toBe(1);
    expect(
      (await publish(h, { body_template: 'v2 {{amount_text}} {{reference_no}}' })).template_version,
    ).toBe(2);
    expect((await publish(h, { locale: 'hi-IN' })).template_version).toBe(1);
    const list = await h.call(
      'GET',
      `/v1/notification-templates/${TEMPLATE_BODY.template_ref}`,
      undefined,
      { key: null },
    );
    expect(list.status).toBe(200);
    expect((list.body as Body)['versions']).toHaveLength(3);
  });

  it('refuses PII-shaped parameter names and out-of-list placeholders', async () => {
    const h = makeHarness();
    const bad = await h.call('POST', '/v1/notification-templates', {
      ...TEMPLATE_BODY,
      body_template: '{{mobile_number}}',
      allowed_params: ['mobile_number'],
    });
    expect(bad.status).toBe(400);
    const bad2 = await h.call('POST', '/v1/notification-templates', {
      ...TEMPLATE_BODY,
      body_template: '{{nope}}',
    });
    expect(bad2.status).toBe(400);
  });

  it('is officer/admin only and tenant-scoped', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    expect((await h.call('POST', '/v1/notification-templates', TEMPLATE_BODY)).status).toBe(403);
    h.state.ctx = ctxFor(TENANT_A);
    await publish(h);
    h.state.ctx = ctxFor(TENANT_B);
    const other = await h.call(
      'GET',
      `/v1/notification-templates/${TEMPLATE_BODY.template_ref}`,
      undefined,
      { key: null },
    );
    expect(other.status).toBe(404);
  });
});

describe('dispatch (idempotent, tenant-scoped, contract-shaped)', () => {
  it('accepts a dispatch, pins the template version, and returns the FROZEN contract instance', async () => {
    const h = makeHarness();
    await publish(h);
    await publish(h, { body_template: 'v2 {{amount_text}} {{reference_no}}' });
    const r = await dispatch(h);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const body = r.body as Body;
    expect(body['status']).toBe('QUEUED');
    expect(body['template_version']).toBe(2);
    expect(body['dispatch']).toMatchObject({
      contract_id: 'SF-CON-NOTIFICATION-DISPATCH',
      contract_status: 'FROZEN',
      tenant_id: TENANT_A,
      connector_mode: 'SIMULATED',
      raw_pii_in_payload_forbidden: true,
      simulation_marker_required_when_simulated: true,
    });
    expect(body['simulation_marker']).toMatchObject({
      simulation: true,
      connector_binding_id: BINDING_SMS,
    });
  });

  it('honours an explicit template version pin and refuses a missing template', async () => {
    const h = makeHarness();
    await publish(h);
    await publish(h, { body_template: 'v2 {{amount_text}} {{reference_no}}' });
    expect(((await dispatch(h, { template_version: 1 })).body as Body)['template_version']).toBe(1);
    expect((await dispatch(h, { template_version: 9 })).status).toBe(404);
    expect((await dispatch(h, { template_ref: 'tpl.unknown' })).status).toBe(404);
  });

  it('replays the same idempotency key + body once and refuses a different body', async () => {
    const h = makeHarness();
    await publish(h);
    const a = await dispatch(h, {}, 'notify-idem-0001');
    const b = await dispatch(h, {}, 'notify-idem-0001');
    expect(b.status).toBe(202);
    expect(b.body).toEqual(a.body);
    expect(h.repo.tenant(TENANT_A).dispatches.size).toBe(1);
    expect(
      h.repo.tenant(TENANT_A).outbox.filter((o) => o.envelope.event_type === 'NotificationQueued'),
    ).toHaveLength(1);
    const c = await dispatch(
      h,
      { locale: 'en-IN', template_params: { amount_text: 'INR 1', reference_no: 'R-1' } },
      'notify-idem-0001',
    );
    expect(c.status).toBe(409);
  });

  it('refuses the same key from another principal in the same tenant (dispatch key is tenant-unique)', async () => {
    const h = makeHarness();
    await publish(h);
    await dispatch(h, {}, 'notify-idem-0002');
    h.state.ctx = integrationCtx();
    const r = await dispatch(h, {}, 'notify-idem-0002');
    expect(r.status).toBe(409);
    expect(h.repo.tenant(TENANT_A).dispatches.size).toBe(1);
  });

  it('requires a declared purpose for INTEGRATION actors (SF-CON-REQUEST-CONTEXT)', async () => {
    const h = makeHarness();
    await publish(h);
    const { purpose, ...withoutPurpose } = integrationCtx();
    expect(purpose).toBeTruthy();
    h.state.ctx = withoutPurpose;
    expect((await dispatch(h)).status).toBe(401);
    h.state.ctx = integrationCtx();
    expect((await dispatch(h)).status).toBe(202);
  });

  it('requires an Idempotency-Key header', async () => {
    const h = makeHarness();
    await publish(h);
    const r = await h.call('POST', '/v1/notifications', DISPATCH_BODY, { key: null });
    expect(r.status).toBe(400);
  });

  it('keeps tenants isolated: the other tenant cannot read or reuse a dispatch or binding', async () => {
    const h = makeHarness();
    await publish(h);
    const id = ((await dispatch(h)).body as Body)['dispatch'].dispatch_id as string;
    h.state.ctx = ctxFor(TENANT_B);
    expect((await h.call('GET', `/v1/notifications/${id}`, undefined, { key: null })).status).toBe(
      404,
    );
    const crossBinding = await dispatch(h);
    expect(crossBinding.status).toBe(403);
    expect(h.repo.tenant(TENANT_B).dispatches.size).toBe(0);
  });

  it('refuses tenant-identifying headers and client-supplied connector mode, tenant or time', async () => {
    const h = makeHarness();
    await publish(h);
    expect(
      (
        await h.call('POST', '/v1/notifications', DISPATCH_BODY, {
          headers: { 'x-tenant-id': TENANT_B },
        })
      ).status,
    ).toBe(403);
    for (const extra of [
      { connector_mode: 'REAL' },
      { tenant_id: TENANT_B },
      { simulation_marker: { simulation: true } },
      { recipient_address: CANARY_ADDRESS },
      { requested_at: '2020-01-01T00:00:00Z' },
    ]) {
      expect((await dispatch(h, extra)).status, JSON.stringify(extra)).toBe(400);
    }
  });

  it('refuses raw PII in template parameters without echoing the value', async () => {
    const h = makeHarness();
    await publish(h);
    for (const value of [CANARY_ADDRESS, 'someone@example.invalid', 'ABCDE1234F']) {
      const r = await dispatch(h, { template_params: { amount_text: value, reference_no: 'R-1' } });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain(value);
      expect((r.body as Body)['details'][0].code).toBe('PII_IN_PARAM_REFUSED');
    }
    expect(h.repo.tenant(TENANT_A).dispatches.size).toBe(0);
  });

  it('refuses missing or extra template parameters', async () => {
    const h = makeHarness();
    await publish(h);
    expect((await dispatch(h, { template_params: { amount_text: 'INR 1' } })).status).toBe(400);
    expect(
      (await dispatch(h, { template_params: { amount_text: 'a', reference_no: 'b', extra: 'c' } }))
        .status,
    ).toBe(400);
  });

  it('refuses citizen actors and fails closed on PDP denial or outage', async () => {
    const h = makeHarness();
    await publish(h);
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    expect((await dispatch(h)).status).toBe(403);
    h.state.ctx = ctxFor(TENANT_A);
    h.authorizer.deny = true;
    expect((await dispatch(h)).status).toBe(403);
    h.authorizer.deny = false;
    h.authorizer.fail = true;
    expect((await dispatch(h)).status).toBe(503);
    expect(h.repo.tenant(TENANT_A).dispatches.size).toBe(0);
  });

  it('missing tenant context is a 401 and never reaches the repository', async () => {
    const h = makeHarness();
    h.state.ctx = null;
    expect((await dispatch(h)).status).toBe(401);
    expect(h.repo.txCount).toBe(0);
  });
});

describe('INT-013 fail-closed connector boundary at dispatch', () => {
  it.each([
    ['unknown binding', () => undefined, 'CONNECTOR_BINDING_NOT_FOUND'],
    [
      'SIMULATED critical in PRODUCTION',
      () => simulatedBinding({ environment: 'PRODUCTION', critical: true }),
      'CRITICAL_NON_REAL_IN_PRODUCTION',
    ],
    [
      'wrong connector type',
      () => simulatedBinding({ connector_type: 'EMAIL' }),
      'CONNECTOR_TYPE_MISMATCH',
    ],
    [
      'binding for another environment',
      () => realBinding({ environment: 'UAT' }),
      'CONNECTOR_ENVIRONMENT_MISMATCH',
    ],
  ])('%s -> 503 SF-INT-001 and nothing persisted', async (_name, make, expected) => {
    const h = makeHarness();
    await publish(h);
    const b = make();
    if (b === undefined) h.bindings.bindings.delete(BINDING_SMS);
    else h.bindings.bindings.set(BINDING_SMS, b);
    const r = await dispatch(h);
    expect(r.status).toBe(503);
    expect((r.body as Body)['error_code']).toBe('SF-INT-001');
    expect((r.body as Body)['details'][0].code).toBe(expected);
    expect(h.repo.tenant(TENANT_A).dispatches.size).toBe(0);
    expect(
      h.repo.tenant(TENANT_A).outbox.filter((o) => o.envelope.event_type === 'NotificationQueued'),
    ).toHaveLength(0);
  });

  it('a hub outage while resolving the binding fails closed without leaking provider detail', async () => {
    const h = makeHarness();
    await publish(h);
    h.bindings.down = true;
    const r = await dispatch(h);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('CANARY');
    expect(h.repo.tenant(TENANT_A).dispatches.size).toBe(0);
  });

  it('refuses a SIMULATED dispatch when no simulation run id is configured', async () => {
    const h = makeHarness({ testRunId: undefined });
    await publish(h);
    expect((await dispatch(h)).status).toBe(503);
  });

  it('refuses PUSH and IN_APP channels until a connector type exists (CCR residual)', async () => {
    const h = makeHarness();
    await publish(h, { channel: 'PUSH' });
    const r = await dispatch(h, { channel: 'PUSH' });
    expect(r.status).toBe(503);
    expect((r.body as Body)['details'][0].code).toBe('CHANNEL_CONNECTOR_UNMAPPED');
  });

  it('refuses when no adapter is bound for the binding (no silent drop)', async () => {
    const h = makeHarness();
    await publish(h);
    h.bindings.bindings.set(
      BINDING_EMAIL,
      simulatedBinding({ connector_binding_id: BINDING_EMAIL, connector_type: 'EMAIL' }),
    );
    await publish(h, { channel: 'EMAIL', body_template: 'x {{amount_text}} {{reference_no}}' });
    const r = await dispatch(h, { channel: 'EMAIL', connector_binding_id: BINDING_EMAIL });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    h.bindings.bindings.set(BINDING_SMS, realBinding({ environment: 'CI' }));
    expect((await dispatch(h)).status).toBe(503);
  });
});

describe('no network inside DB transactions', () => {
  it('resolves the binding and authorizes strictly outside any transaction', async () => {
    const h = makeHarness();
    await publish(h);
    const r = await dispatch(h);
    expect(r.status).toBe(202);
    expect(h.bindings.calls).toBeGreaterThan(0);
  });

  it('refuses to start a nested transaction (guards NETWORK_IN_TX)', async () => {
    const h = makeHarness();
    await publish(h);
    await expect(
      h.repo.withTx(ctxFor(TENANT_A), () => h.service.resolveBinding(TENANT_A, BINDING_SMS, 'SMS')),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });
});
