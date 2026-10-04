import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerCatalogue } from '../../src/plugin.js';
import {
  ACTOR_A,
  ACTOR_OFFICER,
  T1,
  T2,
  bearer,
  buildApp,
  closeHarness,
  ctx,
  idem,
  setupHarness,
  type Harness,
} from './helpers.js';
import { fixtures } from '../doubles/context-resolver.js';

describe('CMP-001 API negatives / INT-013', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('forged tenant header is denied with zero leakage', async () => {
    const { app } = await buildApp(h);
    fixtures.set(
      'officer-t1',
      ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/offerings',
      headers: { ...bearer('officer-t1'), 'x-tenant-id': T2 },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain(T2);
    await app.close();
  });

  it('plugin refuses production critical SIMULATED bindings', async () => {
    const app = Fastify({ logger: false });
    await expect(
      registerCatalogue(app, {
        pool: h.rt,
        resolveContext: async () => null,
        authorizer: {
          decide: async () => ({
            allow: true,
            reason_code: 'ALLOW',
            policy_revision: 'x',
            decision_id: T1,
          }),
        },
        connectorBindings: [{ critical: true, mode: 'SIMULATED', environment: 'PRODUCTION' }],
      }),
    ).rejects.toMatchObject({ code: 'SF-INT-001' });
    await app.close();
  });

  it('officer without tenant cannot hit offering commands', async () => {
    const { app } = await buildApp(h);
    fixtures.set(
      'admin-a',
      ctx({ tenant_id: null, actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A } }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/offerings',
      headers: { ...bearer('admin-a'), ...idem('idem-off-1x') },
      payload: {
        canonical_service_id: T1,
        offering_code: 'off-z',
        local_name: 'Z',
      },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
