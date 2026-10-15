import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import type { FastifyInstance } from 'fastify';
import type { ContractAuthorizer } from '../doubles/authorizer.js';

describe('CMP-058 API flow (PostgreSQL)', () => {
  let h: Harness;
  let app: FastifyInstance;
  let authorizer: ContractAuthorizer;

  beforeAll(async () => {
    h = await setupHarness();
    const built = await buildApp(h);
    app = built.app;
    authorizer = built.authorizer;
    fixtures.set(
      'admin',
      ctx({
        tenant_id: null,
        actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A },
        auth_assurance: 'MFA',
      }),
    );
    fixtures.set('t1', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
    fixtures.set('t2', ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await closeHarness(h);
  });

  beforeEach(() => {
    authorizer.denies.clear();
  });

  it('draft → publish → bind → validate → usage (opaque refs only)', async () => {
    const elementId = randomUUID();
    const bindingId = randomUUID();
    const offeringId = randomUUID();
    const createKey = `idem-create-${randomUUID().slice(0, 8)}`;

    const created = await app.inject({
      method: 'POST',
      url: '/v1/elements',
      headers: { ...bearer('admin'), ...idem(createKey), 'content-type': 'application/json' },
      payload: {
        element_id: elementId,
        element_code: 'semantic.applicant.full_name_ref',
        privacy_classification: 'PII',
        idempotency_key: createKey,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('statutory_meaning');

    const pubKey = `idem-pub-${randomUUID().slice(0, 8)}`;
    const published = await app.inject({
      method: 'POST',
      url: `/v1/elements/${elementId}/publish`,
      headers: { ...bearer('admin'), ...idem(pubKey), 'content-type': 'application/json' },
      payload: { idempotency_key: pubKey },
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as { lifecycle_status: string }).lifecycle_status).toBe('PUBLISHED');

    const bindKey = `idem-bind-${randomUUID().slice(0, 8)}`;
    const bound = await app.inject({
      method: 'POST',
      url: '/v1/bindings',
      headers: { ...bearer('t1'), ...idem(bindKey), 'content-type': 'application/json' },
      payload: {
        binding_id: bindingId,
        offering_id: offeringId,
        field_path: 'applicant.full_name',
        element_id: elementId,
        element_version: 1,
        idempotency_key: bindKey,
      },
    });
    expect(bound.statusCode).toBe(201);

    const validated = await app.inject({
      method: 'POST',
      url: '/v1/mappings/validate',
      headers: { ...bearer('t1'), 'content-type': 'application/json' },
      payload: {
        element_id: elementId,
        element_version: 1,
        field_path: 'applicant.full_name',
      },
    });
    expect(validated.statusCode).toBe(200);
    const v = validated.json<Record<string, unknown>>();
    expect(v['valid']).toBe(true);
    expect(v['invented_statutory_policy_forbidden']).toBe(true);

    const usage = await app.inject({
      method: 'GET',
      url: `/v1/usage/${elementId}`,
      headers: bearer('t1'),
    });
    expect(usage.statusCode).toBe(200);
    expect((usage.json() as { binding_count: number }).binding_count).toBe(1);

    const t2Usage = await app.inject({
      method: 'GET',
      url: `/v1/usage/${elementId}`,
      headers: bearer('t2'),
    });
    expect(t2Usage.statusCode).toBe(200);
    expect((t2Usage.json() as { binding_count: number }).binding_count).toBe(0);
  });

  it('rejects binding to unpublished element', async () => {
    const elementId = randomUUID();
    const createKey = `idem-draft-${randomUUID().slice(0, 8)}`;
    await app.inject({
      method: 'POST',
      url: '/v1/elements',
      headers: { ...bearer('admin'), ...idem(createKey), 'content-type': 'application/json' },
      payload: {
        element_id: elementId,
        element_code: `semantic.draft.${elementId.slice(0, 8)}`,
        privacy_classification: 'PUBLIC',
        idempotency_key: createKey,
      },
    });
    const bindKey = `idem-bad-${randomUUID().slice(0, 8)}`;
    const bound = await app.inject({
      method: 'POST',
      url: '/v1/bindings',
      headers: { ...bearer('t1'), ...idem(bindKey), 'content-type': 'application/json' },
      payload: {
        binding_id: randomUUID(),
        offering_id: randomUUID(),
        field_path: 'x.y',
        element_id: elementId,
        element_version: 1,
        idempotency_key: bindKey,
      },
    });
    expect(bound.statusCode).toBe(409);
  });
});
