import { describe, expect, it } from 'vitest';
import type { HubDeliveryRequest, HubTransport } from '../../src/connectors/hub-channel.js';
import { LEASE_MS } from '../../src/domain/model.js';
import { NotificationService } from '../../src/service/service.js';
import { NotificationDeliveryWorker } from '../../src/service/delivery.js';
import { makeHarness, type Harness } from '../doubles/harness.js';
import {
  ACTOR_OFFICER,
  BINDING_SMS,
  CANARY_ADDRESS,
  CANARY_SECRET_REF,
  ctxFor,
  DISPATCH_BODY,
  integrationCtx,
  realBinding,
  simulatedBinding,
  systemCtx,
  TEMPLATE_BODY,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function seed(h: Harness): Promise<string> {
  expect((await h.call('POST', '/v1/notification-templates', TEMPLATE_BODY)).status).toBe(201);
  const r = await h.call('POST', '/v1/notifications', DISPATCH_BODY);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return (r.body as Body)['dispatch'].dispatch_id as string;
}

const row = (h: Harness, id: string) => {
  const found = h.repo.tenant(TENANT_A).dispatches.get(id);
  if (!found) throw new Error('dispatch missing');
  return found;
};
const sinkOf = (h: Harness) => {
  const connector = h.registry.simulatedConnector(BINDING_SMS);
  if (!connector) throw new Error('simulated connector missing');
  return connector.sink;
};
const attempts = (h: Harness) => h.repo.tenant(TENANT_A).attempts;
const events = (h: Harness, type: string) =>
  h.repo.tenant(TENANT_A).outbox.filter((o) => o.envelope.event_type === type);

describe('delivery worker over the SIMULATED connector (INT-013)', () => {
  it('sends outside any transaction, marks the sink TEST/SIMULATED and records the SimulationMarker', async () => {
    let inTx = true;
    const h: Harness = makeHarness({
      scenarioFor: () => {
        inTx = h.repo.inTransaction();
        return 'accepted';
      },
    });
    const id = await seed(h);
    const out = await h.worker.deliverDue(systemCtx());
    expect(out).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    expect(inTx).toBe(false);

    const d = row(h, id);
    expect(d.status).toBe('SENT');
    expect(d.provider_message_ref).toBe(`sim:${id}`);
    expect(d.lease_owner).toBeNull();
    expect(d.attempts).toBe(1);
    expect(attempts(h)).toHaveLength(1);
    expect(attempts(h)[0]).toMatchObject({ outcome: 'ACCEPTED', connector_mode: 'SIMULATED' });
    expect(attempts(h)[0]?.simulation_marker).toMatchObject({
      simulation: true,
      environment: 'CI',
    });

    const sink = sinkOf(h);
    expect(sink).toHaveLength(1);
    expect(sink[0]?.body).toBe(
      '[TEST/SIMULATED run=run-cmp025-unit] Payment of INR 150 received for APP-2026-000123.',
    );
    expect(JSON.stringify(sink)).not.toContain(CANARY_ADDRESS);

    const sent = events(h, 'NotificationSent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.envelope.data).toMatchObject({
      simulated: true,
      connector_mode: 'SIMULATED',
      status: 'SENT',
    });
  });

  it('exposes the attempt history on read', async () => {
    const h = makeHarness();
    const id = await seed(h);
    await h.worker.deliverDue(systemCtx());
    const r = await h.call('GET', `/v1/notifications/${id}`, undefined, { key: null });
    expect(r.status).toBe(200);
    expect((r.body as Body)['status']).toBe('SENT');
    expect((r.body as Body)['attempt_history']).toHaveLength(1);
    expect((r.body as Body)['attempt_history'][0].simulation_marker.simulation).toBe(true);
  });

  it('does nothing when nothing is due and honours the claim limit', async () => {
    const h = makeHarness();
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ claimed: 0 });
    await seed(h);
    await h.call('POST', '/v1/notifications', DISPATCH_BODY, { key: 'second-dispatch-key' });
    expect(await h.worker.deliverDue(systemCtx(), { limit: 1 })).toMatchObject({
      claimed: 1,
      sent: 1,
    });
    expect(await h.worker.deliverDue(systemCtx(), { limit: 5 })).toMatchObject({
      claimed: 1,
      sent: 1,
    });
  });

  it('retries transient failures with deterministic backoff, then fails terminally at max attempts', async () => {
    const h = makeHarness({ scenarioFor: () => 'transient_failure' });
    const id = await seed(h);
    const waits = [30_000, 60_000, 120_000, 240_000];
    for (const [i, wait] of waits.entries()) {
      const out = await h.worker.deliverDue(systemCtx());
      expect(out.retried, `attempt ${String(i + 1)}`).toBe(1);
      const d = row(h, id);
      expect(d.status).toBe('QUEUED');
      expect(d.last_error_code).toBe('PROVIDER_UNAVAILABLE');
      expect(Date.parse(d.next_attempt_at) - h.clock.now().getTime()).toBe(wait);
      expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ claimed: 0 });
      h.clock.advance(wait);
    }
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ failed: 1 });
    const d = row(h, id);
    expect(d.status).toBe('FAILED');
    expect(d.attempts).toBe(5);
    expect(attempts(h).map((a) => a.outcome)).toEqual(Array(5).fill('TRANSIENT_FAILURE'));
    expect(events(h, 'NotificationRetryScheduled')).toHaveLength(4);
    expect(events(h, 'NotificationFailed')).toHaveLength(1);
    h.clock.advance(86_400_000);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ claimed: 0 });
  });

  it('fails permanently on a permanent provider rejection without retry', async () => {
    const h = makeHarness({ scenarioFor: () => 'permanent_failure' });
    const id = await seed(h);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ failed: 1 });
    expect(row(h, id)).toMatchObject({
      status: 'FAILED',
      last_error_code: 'RECIPIENT_REJECTED',
      attempts: 1,
    });
    expect(attempts(h)[0]?.outcome).toBe('PERMANENT_FAILURE');
  });

  it('treats a connector exception as transient without leaking its message', async () => {
    const h = makeHarness({ scenarioFor: () => 'timeout' });
    const id = await seed(h);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ retried: 1 });
    expect(row(h, id).last_error_code).toBe('CONNECTOR_ERROR');
  });

  it('re-claims an expired lease after a crash and sends once more (at-least-once)', async () => {
    const h = makeHarness();
    const id = await seed(h);
    await h.repo.withTx(systemCtx(), (tx) =>
      tx.claimDue({
        limit: 5,
        now: h.clock.now(),
        leaseOwner: 'crashed-worker',
        leaseMs: LEASE_MS,
      }),
    );
    expect(row(h, id).status).toBe('SENDING');
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ claimed: 0 });
    h.clock.advance(LEASE_MS + 1);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ claimed: 1, sent: 1 });
    expect(row(h, id)).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(attempts(h).map((a) => a.attempt_no)).toEqual([2]);
  });

  it('abandons a lease-exhausted dispatch instead of sending forever', async () => {
    const h = makeHarness();
    const id = await seed(h);
    const d = row(h, id);
    for (let i = 0; i < d.max_attempts; i += 1) {
      await h.repo.withTx(systemCtx(), (tx) =>
        tx.claimDue({
          limit: 1,
          now: h.clock.now(),
          leaseOwner: `crash-${String(i)}`,
          leaseMs: LEASE_MS,
        }),
      );
      h.clock.advance(LEASE_MS + 1);
    }
    expect(row(h, id).attempts).toBe(d.max_attempts);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ failed: 1 });
    expect(row(h, id)).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MAX_ATTEMPTS_EXCEEDED',
    });
    expect(h.registry.simulatedConnector(BINDING_SMS)?.sink ?? []).toHaveLength(0);
  });

  it('a worker that lost its lease writes nothing (no double finalize)', async () => {
    const holder: { second?: NotificationDeliveryWorker } = {};
    let secondSummary: Awaited<ReturnType<NotificationDeliveryWorker['deliverDue']>> | undefined;
    let armed = true;
    const h: Harness = makeHarness({
      wrapConnector: (c) => ({
        mode: c.mode,
        connectorBindingId: c.connectorBindingId,
        ...(c.simulation ? { simulation: c.simulation } : {}),
        async send(req) {
          const out = await c.send(req);
          if (armed && holder.second) {
            armed = false;
            h.clock.advance(LEASE_MS + 1);
            secondSummary = await holder.second.deliverDue(systemCtx());
          }
          return out;
        },
      }),
    });
    const id = await seed(h);
    holder.second = new NotificationDeliveryWorker(
      new NotificationService({ ...h.service.deps, workerId: 'worker-test-2' }),
    );
    const first = await h.worker.deliverDue(systemCtx());
    expect(first).toMatchObject({ claimed: 1, sent: 0, lostLease: 1 });
    expect(secondSummary).toMatchObject({ claimed: 1, sent: 1 });
    expect(row(h, id)).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(attempts(h).map((a) => a.attempt_no)).toEqual([2]);
    expect(events(h, 'NotificationSent')).toHaveLength(1);
    expect(h.registry.simulatedConnector(BINDING_SMS)?.sink).toHaveLength(2);
  });

  it('only a SYSTEM actor may drain, and PDP outage fails closed', async () => {
    const h = makeHarness();
    await seed(h);
    await expect(
      h.worker.deliverDue(ctxFor(TENANT_A, ACTOR_OFFICER, 'OFFICER')),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    h.authorizer.fail = true;
    await expect(h.worker.deliverDue(systemCtx())).rejects.toMatchObject({ code: 'SF-SYS-004' });
    h.authorizer.fail = false;
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ sent: 1 });
  });

  it('never drains another tenant', async () => {
    const h = makeHarness();
    await seed(h);
    expect(await h.worker.deliverDue(systemCtx(TENANT_B))).toMatchObject({ claimed: 0 });
    expect(await h.worker.deliverDue(systemCtx(TENANT_A))).toMatchObject({ sent: 1 });
  });
});

describe('delivery re-validates the connector boundary (fail-closed, nothing sent)', () => {
  it.each([
    [
      'critical SIMULATED in PRODUCTION',
      simulatedBinding({ environment: 'PRODUCTION', critical: true }),
      'CRITICAL_NON_REAL_IN_PRODUCTION',
    ],
    [
      'mode drift to REAL',
      realBinding({ environment: 'CI' }),
      'NON_SIMULATED_IN_LOCAL_OR_CI_REFUSED',
    ],
    [
      'environment drift',
      simulatedBinding({ environment: 'SIT' }),
      'CONNECTOR_ENVIRONMENT_MISMATCH',
    ],
  ])('%s', async (_name, drifted, code) => {
    const h = makeHarness();
    const id = await seed(h);
    h.bindings.bindings.set(BINDING_SMS, drifted);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ failed: 1 });
    expect(row(h, id)).toMatchObject({ status: 'FAILED', last_error_code: code });
    expect(h.registry.simulatedConnector(BINDING_SMS)?.sink ?? []).toHaveLength(0);
  });

  it('retries (does not fail) when the binding source is unavailable', async () => {
    const h = makeHarness();
    const id = await seed(h);
    h.bindings.down = true;
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ retried: 1 });
    expect(row(h, id)).toMatchObject({
      status: 'QUEUED',
      last_error_code: 'CONNECTOR_BINDING_UNAVAILABLE',
    });
    h.bindings.down = false;
    h.clock.advance(30_000);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ sent: 1 });
  });

  it('a binding that now belongs to another tenant is refused', async () => {
    const h = makeHarness();
    const id = await seed(h);
    h.bindings.bindings.set(BINDING_SMS, simulatedBinding({ tenant_id: TENANT_B }));
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ failed: 1 });
    expect(row(h, id).last_error_code).toBe('CROSS_TENANT_BINDING');
  });

  it('unresolved recipient is permanent; directory outage is transient and not leaked', async () => {
    const h = makeHarness();
    const id = await seed(h);
    h.recipients.down = true;
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ retried: 1 });
    expect(row(h, id).last_error_code).toBe('RECIPIENT_DIRECTORY_UNAVAILABLE');
    expect(JSON.stringify([...h.repo.tenant(TENANT_A).dispatches.values()])).not.toContain(
      CANARY_ADDRESS,
    );
    h.recipients.down = false;
    h.recipients.addresses.clear();
    h.clock.advance(30_000);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ failed: 1 });
    expect(row(h, id).last_error_code).toBe('RECIPIENT_UNRESOLVED');
  });

  it('a missing adapter is transient (host may bind later), never a silent success', async () => {
    const h = makeHarness();
    const id = await seed(h);
    const unbound = new NotificationDeliveryWorker(
      new NotificationService({ ...h.service.deps, connectors: { forBinding: () => null } }),
    );
    expect(await unbound.deliverDue(systemCtx())).toMatchObject({ retried: 1, sent: 0 });
    expect(row(h, id)).toMatchObject({ status: 'QUEUED', last_error_code: 'CONNECTOR_NOT_BOUND' });
  });
});

describe('REAL and SANDBOX delivery via the Integration Hub port', () => {
  function hubHarness(
    env: 'UAT' | 'PRODUCTION',
    mode: 'REAL' | 'SANDBOX',
    hubResult: 'ok' | 'down' | 'bad',
  ) {
    const seen: HubDeliveryRequest[] = [];
    const hub: HubTransport = {
      deliver(req) {
        seen.push(req);
        if (hubResult === 'down')
          return Promise.reject(new Error(`hub down ${CANARY_ADDRESS} ${CANARY_SECRET_REF}`));
        if (hubResult === 'bad')
          return Promise.resolve({ status: 'PERMANENT_FAILURE', errorCode: 'lower case' });
        return Promise.resolve({ status: 'ACCEPTED', providerMessageRef: 'prov-123' });
      },
    };
    const h = makeHarness({
      environment: env,
      hub,
      noSimulation: true,
      testRunId: undefined,
      binding: realBinding({ environment: env, mode, critical: env === 'PRODUCTION' }),
    });
    return { h, seen };
  }

  it.each([
    ['UAT', 'SANDBOX'],
    ['PRODUCTION', 'REAL'],
  ] as const)(
    '%s %s: accepted, no SimulationMarker, secret passed only as a reference',
    async (env, mode) => {
      const { h, seen } = hubHarness(env, mode, 'ok');
      const id = await seed(h);
      expect(row(h, id).simulation_marker).toBeNull();
      expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ sent: 1 });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        mode,
        secretRef: CANARY_SECRET_REF,
        connectorBindingId: BINDING_SMS,
      });
      expect(seen[0]?.request.providerIdempotencyKey).toBe(id);
      expect(row(h, id)).toMatchObject({
        status: 'SENT',
        provider_message_ref: 'prov-123',
        connector_mode: mode,
      });
      expect(attempts(h)[0]?.simulation_marker).toBeNull();
      expect(JSON.stringify(h.logger.lines)).not.toContain(CANARY_SECRET_REF);
    },
  );

  it('hub outage is a transient failure and never leaks hub error text', async () => {
    const { h } = hubHarness('PRODUCTION', 'REAL', 'down');
    const id = await seed(h);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ retried: 1 });
    expect(row(h, id).last_error_code).toBe('HUB_UNAVAILABLE');
    const dump = JSON.stringify([h.repo.tenant(TENANT_A), h.logger.lines]);
    expect(dump).not.toContain(CANARY_ADDRESS);
    expect(dump).not.toContain(CANARY_SECRET_REF);
  });

  it('normalises a malformed hub error code', async () => {
    const { h } = hubHarness('UAT', 'SANDBOX', 'bad');
    const id = await seed(h);
    expect(await h.worker.deliverDue(systemCtx())).toMatchObject({ failed: 1 });
    expect(row(h, id).last_error_code).toBe('HUB_RESPONSE_INVALID');
  });

  it('PRODUCTION never falls back to SIMULATED: a SIMULATED critical binding is refused at dispatch', async () => {
    const h = makeHarness({
      environment: 'PRODUCTION',
      noSimulation: true,
      testRunId: undefined,
      binding: simulatedBinding({ environment: 'PRODUCTION', critical: true }),
    });
    await h.call('POST', '/v1/notification-templates', TEMPLATE_BODY);
    const r = await h.call('POST', '/v1/notifications', DISPATCH_BODY);
    expect(r.status).toBe(503);
    expect((r.body as Body)['details'][0].code).toBe('CRITICAL_NON_REAL_IN_PRODUCTION');
  });
});

describe('delivery receipts', () => {
  async function sent(h: Harness): Promise<{ id: string; ref: string }> {
    const id = await seed(h);
    await h.worker.deliverDue(systemCtx());
    return { id, ref: row(h, id).provider_message_ref as string };
  }

  it('records DELIVERED once, idempotently, and refuses further transitions', async () => {
    const h = makeHarness();
    const { id, ref } = await sent(h);
    h.state.ctx = integrationCtx();
    const body = { outcome: 'DELIVERED', provider_message_ref: ref };
    const a = await h.call('POST', `/v1/notifications/${id}/receipt`, body, {
      key: 'receipt-key-0001',
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect((a.body as Body)['status']).toBe('DELIVERED');
    expect(row(h, id).delivered_at).not.toBeNull();
    const replay = await h.call('POST', `/v1/notifications/${id}/receipt`, body, {
      key: 'receipt-key-0001',
    });
    expect(replay.body).toEqual(a.body);
    const again = await h.call('POST', `/v1/notifications/${id}/receipt`, body, {
      key: 'receipt-key-0002',
    });
    expect(again.status).toBe(409);
    expect(events(h, 'NotificationDelivered')).toHaveLength(1);
  });

  it('records UNDELIVERED, refuses a mismatched provider ref, non-SENT dispatches and non-integration actors', async () => {
    const h = makeHarness();
    const { id, ref } = await sent(h);
    h.state.ctx = integrationCtx();
    const wrong = await h.call('POST', `/v1/notifications/${id}/receipt`, {
      outcome: 'DELIVERED',
      provider_message_ref: 'other',
    });
    expect(wrong.status).toBe(400);
    h.state.ctx = ctxFor(TENANT_A);
    expect(
      (
        await h.call('POST', `/v1/notifications/${id}/receipt`, {
          outcome: 'DELIVERED',
          provider_message_ref: ref,
        })
      ).status,
    ).toBe(403);
    h.state.ctx = integrationCtx();
    const ok = await h.call('POST', `/v1/notifications/${id}/receipt`, {
      outcome: 'UNDELIVERED',
      provider_message_ref: ref,
    });
    expect((ok.body as Body)['status']).toBe('UNDELIVERED');

    const h2 = makeHarness();
    const queued = await seed(h2);
    h2.state.ctx = integrationCtx();
    expect(
      (
        await h2.call('POST', `/v1/notifications/${queued}/receipt`, {
          outcome: 'DELIVERED',
          provider_message_ref: 'x',
        })
      ).status,
    ).toBe(409);
  });

  it('another tenant cannot record a receipt', async () => {
    const h = makeHarness();
    const { id, ref } = await sent(h);
    h.state.ctx = integrationCtx(TENANT_B);
    expect(
      (
        await h.call('POST', `/v1/notifications/${id}/receipt`, {
          outcome: 'DELIVERED',
          provider_message_ref: ref,
        })
      ).status,
    ).toBe(404);
  });
});

describe('no secrets or PII in logs, events, audit or rows', () => {
  it('canary address, email and secret ref never appear anywhere observable', async () => {
    const h = makeHarness();
    await seed(h);
    await h.worker.deliverDue(systemCtx());
    h.recipients.down = true;
    await h.call('POST', '/v1/notifications', DISPATCH_BODY, { key: 'second-dispatch-key' });
    await h.worker.deliverDue(systemCtx());
    const dump = JSON.stringify([
      h.logger.lines,
      h.repo.tenant(TENANT_A).outbox,
      [...h.repo.tenant(TENANT_A).dispatches.values()],
      h.repo.tenant(TENANT_A).attempts,
      h.repo.tenant(TENANT_A).idempotency,
    ]);
    for (const canary of [CANARY_ADDRESS, 'canary.person@example.invalid', CANARY_SECRET_REF]) {
      expect(dump).not.toContain(canary);
    }
    expect(h.logger.lines.length).toBeGreaterThan(0);
    for (const line of h.logger.lines) {
      for (const key of Object.keys(line)) {
        expect([
          'level',
          'event',
          'tenant_id',
          'dispatch_id',
          'correlation_id',
          'channel',
          'status',
          'connector_mode',
          'attempt',
          'outcome',
          'error_code',
        ]).toContain(key);
      }
    }
  });
});
