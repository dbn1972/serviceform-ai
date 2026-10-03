import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@serviceform/observability';
import { CircuitBreakerRegistry } from '@serviceform/connector-sdk';
import { EchoSimulatorAdapter } from '../../../simulators/framework/src/index.js';
import { echoSignedHeaders } from '../../../simulators/framework/src/echo-webhook.js';
import { SecretMaterial } from '../../../packages/connector-sdk/src/secrets.js';
import { loadHubConfig } from '../src/config.js';
import { registerIntegrationHub } from '../src/plugin.js';
import { createPgHub } from '../src/pg.js';
import { allowAuth, CANARY, ctx, definition, simulatedBinding } from './support/fixtures.js';
import { databaseUrl, migrate } from './support/db.js';
import { InMemorySecretResolver } from '../../../packages/connector-sdk/test/support/in-memory-secrets.js';

const config = loadHubConfig({ SF_ENVIRONMENT: 'CI', SF_CELL_ID: 'cell-01' });

describe('createPgHub against PostgreSQL (duplicate webhook, RLS session)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    migrate('up');
    pool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('persists one webhook transaction and one outbox event for duplicate callbacks', async () => {
    const hub = createPgHub(pool);
    const binding = simulatedBinding();
    const def = definition(`echo-${binding.connector_binding_id}`);
    const request = ctx();
    await hub.uow.withTransaction(request, async () => {
      await hub.bindings.insertDefinition(def);
      await hub.bindings.insertBinding({ binding, definition: def });
    });
    const loaded = await hub.uow.withTransaction(request, () =>
      hub.bindings.getById(binding.connector_binding_id),
    );
    expect(loaded?.binding.connector_binding_id).toBe(binding.connector_binding_id);
    expect(await hub.bindings.resolveWebhookTenant(binding.connector_binding_id)).toBe(
      binding.tenant_id,
    );

    const secrets = new InMemorySecretResolver();
    secrets.put('vault://sim/echo-webhook', CANARY);
    const app = Fastify({
      genReqId: () => randomUUID(),
    });
    await registerIntegrationHub(app, {
      config,
      logger: createLogger({
        service: 'cmp-037-int',
        version: 'test',
        level: 'silent',
        destination: new Writable({
          write(_c, _e, cb) {
            cb();
          },
        }),
      }),
      uow: hub.uow,
      bindings: hub.bindings,
      transactions: hub.transactions,
      outbox: hub.outbox,
      inbox: hub.inbox,
      secrets,
      adapters: new Map([[def.adapter_key, new EchoSimulatorAdapter()]]),
      authorization: allowAuth,
      requestContext: () => request,
      breaker: new CircuitBreakerRegistry(),
    });

    const body = Buffer.from(
      JSON.stringify({
        provider_reference: `dup-${binding.connector_binding_id}`,
        scenario: 'duplicate_callback',
        test_run_id: 'run-pg-1',
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

    const counts = await hub.uow.withTransaction(request, async () => {
      const tx = await pool.query(
        `SELECT count(*)::int AS n FROM sf_integration_hub.connector_transaction
          WHERE connector_binding_id = $1 AND direction = 'WEBHOOK'`,
        [binding.connector_binding_id],
      );
      const events = await pool.query(
        `SELECT count(*)::int AS n FROM sf_integration_hub.outbox_event
          WHERE aggregate_id = $1`,
        [first.json()['connector_transaction_id']],
      );
      return { tx: tx.rows[0]?.['n'], events: events.rows[0]?.['n'] };
    });
    expect(counts.tx).toBe(1);
    expect(counts.events).toBe(1);
    await app.close();
  });
});
