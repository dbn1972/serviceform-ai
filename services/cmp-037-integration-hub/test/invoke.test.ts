import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '@serviceform/observability';
import {
  CircuitBreakerRegistry,
  ProductionSimulatedCriticalConnectorError,
  runInTransaction,
} from '@serviceform/connector-sdk';
import { EchoSimulatorAdapter } from '../../../simulators/framework/src/index.js';
import { echoSignedHeaders } from '../../../simulators/framework/src/echo-webhook.js';
import { SecretMaterial } from '../../../packages/connector-sdk/src/secrets.js';
import { loadHubConfig } from '../src/config.js';
import { registerIntegrationHub } from '../src/plugin.js';
import { ConnectorInvoker, fingerprintOf } from '../src/invoker.js';
import { denyAllAuthorization } from '../src/ports.js';
import { noopMetrics } from '../src/ports.js';
import {
  CANARY,
  RecordingAdapter,
  T2,
  allowAuth,
  ctx,
  seededStore,
  simulatedBinding,
} from './support/fixtures.js';

const config = loadHubConfig({ SF_ENVIRONMENT: 'CI', SF_CELL_ID: 'cell-01' });

function logger() {
  return createLogger({
    service: 'cmp-037-test',
    version: 'test',
    level: 'silent',
    destination: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  });
}

describe('invoke saga (005-06, 005-19, 005-30, 005-31, 005-32, 005-33)', () => {
  it('denies by default with no provider call', async () => {
    const { store, binding, secrets } = seededStore();
    const adapter = new RecordingAdapter();
    const invoker = new ConnectorInvoker({
      config,
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      authz: denyAllAuthorization,
      secrets,
      adapters: new Map([['echo', adapter]]),
      breaker: new CircuitBreakerRegistry(),
      metrics: noopMetrics,
    });
    await expect(
      invoker.invoke({
        bindingId: binding.connector_binding_id,
        ctx: ctx(),
        body: { operation: 'ping', test_run_id: 'run-1' },
        idempotencyKey: 'idem-key-01',
        rawFingerprint: fingerprintOf('a'),
      }),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    expect(adapter.calls).toBe(0);
  });

  it('rejects missing tenant, body tenant_id and mode overrides', async () => {
    const { store, binding, secrets } = seededStore();
    const adapter = new RecordingAdapter();
    const invoker = new ConnectorInvoker({
      config,
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      authz: allowAuth,
      secrets,
      adapters: new Map([['echo', adapter]]),
      breaker: new CircuitBreakerRegistry(),
      metrics: noopMetrics,
    });
    const missing = ctx();
    await expect(
      invoker.invoke({
        bindingId: binding.connector_binding_id,
        ctx: { ...missing, tenant_id: null },
        body: { test_run_id: 'run-1' },
        idempotencyKey: undefined,
        rawFingerprint: 'aa',
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
    await expect(
      invoker.invoke({
        bindingId: binding.connector_binding_id,
        ctx: ctx(),
        body: { tenant_id: T2, test_run_id: 'run-1' },
        idempotencyKey: undefined,
        rawFingerprint: 'aa',
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      invoker.invoke({
        bindingId: binding.connector_binding_id,
        ctx: ctx(),
        body: { mode: 'REAL', test_run_id: 'run-1' },
        idempotencyKey: undefined,
        rawFingerprint: 'aa',
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    expect(adapter.calls).toBe(0);
  });

  it('invokes only outside a DB transaction and replays in-progress without a second call', async () => {
    const { store, binding, secrets } = seededStore();
    const adapter = new RecordingAdapter();
    const invoker = new ConnectorInvoker({
      config,
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      authz: allowAuth,
      secrets,
      adapters: new Map([['echo', adapter]]),
      breaker: new CircuitBreakerRegistry(),
      metrics: noopMetrics,
    });
    const body = { operation: 'ping', payload: {}, test_run_id: 'run-1', scenario: 'success' };
    const fp = fingerprintOf('same');
    const first = await invoker.invoke({
      bindingId: binding.connector_binding_id,
      ctx: ctx(),
      body,
      idempotencyKey: 'idem-key-02',
      rawFingerprint: fp,
    });
    expect(first.status).toBe(200);
    expect(adapter.txnOpenAtCall.every((open) => open === false)).toBe(true);
    const replay = await invoker.invoke({
      bindingId: binding.connector_binding_id,
      ctx: ctx(),
      body,
      idempotencyKey: 'idem-key-02',
      rawFingerprint: fp,
    });
    expect(replay.status).toBe(200);
    expect(adapter.calls).toBe(1);
    await expect(
      invoker.invoke({
        bindingId: binding.connector_binding_id,
        ctx: ctx(),
        body,
        idempotencyKey: 'idem-key-02',
        rawFingerprint: fingerprintOf('other'),
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
  });

  it('opens the circuit after timeouts and emits a failed event', async () => {
    const { store, binding, secrets } = seededStore();
    const adapter = new RecordingAdapter();
    adapter.outcome = 'timeout';
    const breaker = new CircuitBreakerRegistry({
      failureThreshold: 1,
      windowMs: 1000,
      openMs: 60_000,
    });
    const invoker = new ConnectorInvoker({
      config,
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      authz: allowAuth,
      secrets,
      adapters: new Map([['echo', adapter]]),
      breaker,
      metrics: noopMetrics,
    });
    await expect(
      invoker.invoke({
        bindingId: binding.connector_binding_id,
        ctx: ctx(),
        body: { test_run_id: 'run-1' },
        idempotencyKey: 'idem-key-03',
        rawFingerprint: 'ff',
      }),
    ).rejects.toMatchObject({ code: 'SF-INT-001' });
    expect(
      store.outbox.some((e: unknown) => JSON.stringify(e).includes('ConnectorInvocationStarted')),
    ).toBe(true);
    expect(
      store.outbox.some((e: unknown) => JSON.stringify(e).includes('ConnectorInvocationFailed')),
    ).toBe(true);
    expect(JSON.stringify(store.outbox)).not.toContain(CANARY);
    expect(JSON.stringify(store.outbox)).not.toMatch(/vault:\/\//);
  });

  it('refuses an adapter call that is made inside withTransaction', async () => {
    const { store, binding, secrets } = seededStore();
    const adapter = new RecordingAdapter();
    const invoker = new ConnectorInvoker({
      config,
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      authz: allowAuth,
      secrets,
      adapters: new Map([['echo', adapter]]),
      breaker: new CircuitBreakerRegistry(),
      metrics: noopMetrics,
    });
    await expect(
      runInTransaction(async () =>
        invoker.invoke({
          bindingId: binding.connector_binding_id,
          ctx: ctx(),
          body: { test_run_id: 'run-1' },
          idempotencyKey: 'idem-key-04',
          rawFingerprint: 'aa',
        }),
      ),
    ).rejects.toMatchObject({ code: 'OUTBOUND_IN_TX' });
  });
});

describe('http plugin', () => {
  const apps: { close: () => Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  it('treats a forged tenant header as cross-tenant and hides unknown bindings', async () => {
    const { store, binding, secrets } = seededStore();
    const adapter = new RecordingAdapter();
    const app = Fastify();
    apps.push(app);
    await registerIntegrationHub(app, {
      config,
      logger: logger(),
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      inbox: store,
      secrets,
      adapters: new Map([['echo', adapter]]),
      authorization: allowAuth,
      requestContext: () => ctx(),
    });
    const forged = await app.inject({
      method: 'POST',
      url: `/v1/connectors/${binding.connector_binding_id}/invoke`,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': T2,
        'idempotency-key': 'idem-key-05',
      },
      payload: Buffer.from(JSON.stringify({ test_run_id: 'run-1' })),
    });
    expect(forged.statusCode).toBe(403);
    const other = await app.inject({
      method: 'POST',
      url: `/v1/connectors/${T2}/invoke`,
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-key-06' },
      payload: Buffer.from(JSON.stringify({ test_run_id: 'run-1' })),
    });
    const missing = await app.inject({
      method: 'POST',
      url: `/v1/connectors/00000000-0000-4000-8000-000000000000/invoke`,
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-key-07' },
      payload: Buffer.from(JSON.stringify({ test_run_id: 'run-1' })),
    });
    expect(other.statusCode).toBe(missing.statusCode);
    expect(other.json()['error_code']).toBe(missing.json()['error_code']);
    expect(adapter.calls).toBe(0);
  });

  it('echo simulator invoke and signed webhook are idempotent', async () => {
    const binding = simulatedBinding();
    const { store, secrets } = seededStore(binding);
    const app = Fastify();
    apps.push(app);
    await registerIntegrationHub(app, {
      config,
      logger: logger(),
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      inbox: store,
      secrets,
      adapters: new Map([['echo', new EchoSimulatorAdapter()]]),
      authorization: allowAuth,
      requestContext: () => ctx(),
    });
    const invoked = await app.inject({
      method: 'POST',
      url: `/v1/connectors/${binding.connector_binding_id}/invoke`,
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-key-08' },
      payload: Buffer.from(
        JSON.stringify({
          operation: 'echo',
          payload: { a: 1 },
          test_run_id: 'run-9',
          scenario: 'success',
        }),
      ),
    });
    expect(invoked.statusCode).toBe(200);
    expect(invoked.json()['label']).toBe('TEST/SIMULATED');
    expect(JSON.stringify(invoked.json())).not.toContain(CANARY);

    const body = Buffer.from(
      JSON.stringify({
        provider_reference: 'cb-1',
        scenario: 'duplicate_callback',
        test_run_id: 'run-9',
      }),
    );
    const headers = echoSignedHeaders(body, new SecretMaterial(CANARY), 1_700_000_000);
    const first = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/${binding.connector_binding_id}`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: body,
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/${binding.connector_binding_id}`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()['duplicate']).toBe(true);
    const tx = [...store.transactions.values()].filter(
      (t: { direction: string }) => t.direction === 'WEBHOOK',
    );
    expect(tx).toHaveLength(1);
    const events = store.outbox.filter((e: unknown) => JSON.stringify(e).includes('WEBHOOK'));
    expect(events).toHaveLength(1);

    const parallel = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: 'POST',
          url: `/v1/webhooks/${binding.connector_binding_id}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: body,
        }),
      ),
    );
    expect(parallel.every((r) => r.statusCode === 200)).toBe(true);
    expect(
      [...store.transactions.values()].filter(
        (t: { direction: string }) => t.direction === 'WEBHOOK',
      ),
    ).toHaveLength(1);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const evidenceDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../evidence/SF-M01-005',
    );
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      join(evidenceDir, 'duplicate-callback.log'),
      [
        `first_status=${first.statusCode}`,
        `second_status=${second.statusCode}`,
        `second_duplicate=${String(second.json()['duplicate'])}`,
        `webhook_transactions=${tx.length}`,
        `webhook_events=${events.length}`,
        `parallel_callbacks=20`,
        `parallel_still_one_transaction=true`,
      ].join('\n') + '\n',
    );
  });

  it('health, 401 webhook, oversized body, in-progress replay and production refuse', async () => {
    const { store, binding, secrets } = seededStore();
    const adapter = new EchoSimulatorAdapter();
    const app = Fastify();
    apps.push(app);
    await registerIntegrationHub(app, {
      config,
      logger: logger(),
      uow: store,
      bindings: store,
      transactions: store,
      outbox: store,
      inbox: store,
      secrets,
      adapters: new Map([['echo', adapter]]),
      authorization: allowAuth,
      requestContext: () => ctx(),
    });
    const health = await app.inject({
      method: 'GET',
      url: `/v1/connectors/${binding.connector_binding_id}/health`,
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()['status']).toBe('ok');
    const unknown = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/00000000-0000-4000-8000-000000000000`,
      headers: { 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    const badSig = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/${binding.connector_binding_id}`,
      headers: {
        'content-type': 'application/json',
        'x-sf-signature': 'aa',
        'x-sf-timestamp': '1700000000',
      },
      payload: Buffer.from('{"provider_reference":"x"}'),
    });
    expect(unknown.statusCode).toBe(401);
    expect(badSig.statusCode).toBe(401);
    expect(unknown.json()['error_code']).toBe(badSig.json()['error_code']);
    const huge = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/${binding.connector_binding_id}`,
      headers: { 'content-type': 'application/json' },
      payload: Buffer.alloc(70_000, 0x61),
    });
    expect([413, 400]).toContain(huge.statusCode);

    const invokerStore = seededStore();
    const rec = new RecordingAdapter();
    const invoker = new ConnectorInvoker({
      config,
      uow: invokerStore.store,
      bindings: invokerStore.store,
      transactions: invokerStore.store,
      outbox: invokerStore.store,
      authz: allowAuth,
      secrets: invokerStore.secrets,
      adapters: new Map([['echo', rec]]),
      breaker: new CircuitBreakerRegistry(),
      metrics: noopMetrics,
    });
    const first = await invoker.invoke({
      bindingId: invokerStore.binding.connector_binding_id,
      ctx: ctx(),
      body: { operation: 'ping', test_run_id: 'run-1' },
      idempotencyKey: 'idem-in-progress',
      rawFingerprint: fingerprintOf('same-ip'),
    });
    expect(first.status).toBe(200);
    const only = [...invokerStore.store.transactions.values()][0];
    if (only) {
      invokerStore.store.transactions.set(only.connector_transaction_id, {
        ...only,
        status: 'IN_PROGRESS',
      });
    }
    const replay = await invoker.invoke({
      bindingId: invokerStore.binding.connector_binding_id,
      ctx: ctx(),
      body: { operation: 'ping', test_run_id: 'run-1' },
      idempotencyKey: 'idem-in-progress',
      rawFingerprint: fingerprintOf('same-ip'),
    });
    expect(replay.status).toBe(409);
    expect(rec.calls).toBe(1);

    const prodApp = Fastify();
    apps.push(prodApp);
    await expect(
      registerIntegrationHub(prodApp, {
        config: loadHubConfig({ SF_ENVIRONMENT: 'PRODUCTION', SF_CELL_ID: 'cell-01' }),
        logger: logger(),
        uow: store,
        bindings: store,
        transactions: store,
        outbox: store,
        inbox: store,
        secrets,
        adapters: new Map([['echo', adapter]]),
        authorization: allowAuth,
        requestContext: () => ctx(),
      }),
    ).rejects.toBeInstanceOf(ProductionSimulatedCriticalConnectorError);
  });
});
