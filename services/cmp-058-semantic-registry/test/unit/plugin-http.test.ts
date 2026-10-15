import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { registerSemantic } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures, frozenClock } from '../doubles/context-resolver.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles:
      partial.actor.type === 'PRIVILEGED_ADMIN' ? ['PLATFORM_OPERATOR'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
        auth_assurance: partial.auth_assurance ?? ('MFA' as const),
    correlation_id: randomUUID(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    ...partial,
  };
}

function key(label: string): string {
  return `idem-${label}-${randomUUID().slice(0, 8)}`;
}

describe('CMP-058 plugin HTTP unit (memory pool)', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let authorizer: ContractAuthorizer;

  beforeAll(async () => {
    store = emptyStore();
    authorizer = new ContractAuthorizer();
    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerSemantic(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
      clock: frozenClock('2026-10-15T10:00:00.000Z'),
    });
    fixtures.set(
      'admin-a',
      ctx({
        tenant_id: null,
        actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A },
        auth_assurance: 'MFA',
      }),
    );
    fixtures.set(
      'admin-nomfa',
      ctx({
        tenant_id: null,
        actor: { type: 'PRIVILEGED_ADMIN', id: ACTOR_A },
        auth_assurance: 'OTP',
      }),
    );
    fixtures.set(
      'officer-t1',
      ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    fixtures.set(
      'officer-t2',
      ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
  });

  afterAll(() => app.close());
  beforeEach(() => {
    store.elements = [];
    store.fieldBindings = [];
    store.idemTenant = [];
    store.idemPlatform = [];
    store.outbox = [];
    store.outboxPlatform = [];
  });

  describe('Semantic Element CRUD', () => {
    it('lists elements (empty)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/elements',
        headers: { authorization: 'Bearer officer-t1' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: unknown[] }>();
      expect(body.items).toHaveLength(0);
    });

    it('creates a DRAFT element (privileged admin)', async () => {
      const elementId = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': key('create-el'),
          'content-type': 'application/json',
        },
        payload: {
          element_id: elementId,
          element_code: 'semantic.applicant.full_name_ref',
          privacy_classification: 'PII',
          idempotency_key: key('create-el'),
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        element_id: string;
        version: number;
        lifecycle_status: string;
        element_code: string;
      }>();
      expect(body.element_id).toBe(elementId);
      expect(body.version).toBe(1);
      expect(body.lifecycle_status).toBe('DRAFT');
      expect(body.element_code).toBe('semantic.applicant.full_name_ref');
      expect(store.elements).toHaveLength(1);
    });

    it('publishes a DRAFT element', async () => {
      const elementId = randomUUID();
      store.elements.push({
        element_id: elementId,
        version: 1,
        element_code: 'semantic.test.ref',
        lifecycle_status: 'DRAFT',
        privacy_classification: 'PUBLIC',
        code_list_binding_ref: null,
        idempotency_key: 'idem-test-0001',
        correlation_id: randomUUID(),
        created_at: '2026-10-15T10:00:00.000Z',
        published_at: null,
        deprecated_at: null,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/elements/${elementId}/publish`,
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': key('pub-el'),
          'content-type': 'application/json',
        },
        payload: { idempotency_key: key('pub-el') },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ lifecycle_status: string }>();
      expect(body.lifecycle_status).toBe('PUBLISHED');
      const elem = store.elements[0];
      expect(elem).toBeDefined();
      expect(elem?.lifecycle_status).toBe('PUBLISHED');
    });

    it('rejects publish of already published element', async () => {
      const elementId = randomUUID();
      store.elements.push({
        element_id: elementId,
        version: 1,
        element_code: 'semantic.test2.ref',
        lifecycle_status: 'PUBLISHED',
        privacy_classification: 'PUBLIC',
        code_list_binding_ref: null,
        idempotency_key: 'idem-test-0002',
        correlation_id: randomUUID(),
        created_at: '2026-10-15T10:00:00.000Z',
        published_at: '2026-10-15T10:00:00.000Z',
        deprecated_at: null,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/elements/${elementId}/publish`,
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': key('pub-el2'),
          'content-type': 'application/json',
        },
        payload: { idempotency_key: key('pub-el2') },
      });
      expect(res.statusCode).toBe(409);
    });

    it('deprecates a PUBLISHED element', async () => {
      const elementId = randomUUID();
      store.elements.push({
        element_id: elementId,
        version: 1,
        element_code: 'semantic.dep.ref',
        lifecycle_status: 'PUBLISHED',
        privacy_classification: 'INTERNAL',
        code_list_binding_ref: null,
        idempotency_key: 'idem-dep-0001',
        correlation_id: randomUUID(),
        created_at: '2026-10-15T10:00:00.000Z',
        published_at: '2026-10-15T10:00:00.000Z',
        deprecated_at: null,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/elements/${elementId}/deprecate`,
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': key('dep-el'),
          'content-type': 'application/json',
        },
        payload: { idempotency_key: key('dep-el') },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ lifecycle_status: string }>();
      expect(body.lifecycle_status).toBe('DEPRECATED');
    });
  });

  describe('Field Bindings', () => {
    it('creates a binding to a published element', async () => {
      const elementId = randomUUID();
      const bindingId = randomUUID();
      const offeringId = randomUUID();
      store.elements.push({
        element_id: elementId,
        version: 1,
        element_code: 'semantic.applicant.dob_ref',
        lifecycle_status: 'PUBLISHED',
        privacy_classification: 'PII',
        code_list_binding_ref: null,
        idempotency_key: 'idem-el-0001',
        correlation_id: randomUUID(),
        created_at: '2026-10-15T10:00:00.000Z',
        published_at: '2026-10-15T10:00:00.000Z',
        deprecated_at: null,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/bindings',
        headers: {
          authorization: 'Bearer officer-t1',
          'idempotency-key': key('bind'),
          'content-type': 'application/json',
        },
        payload: {
          binding_id: bindingId,
          offering_id: offeringId,
          field_path: 'applicant.date_of_birth',
          element_id: elementId,
          element_version: 1,
          idempotency_key: key('bind'),
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ binding_id: string; element_id: string }>();
      expect(body.binding_id).toBe(bindingId);
      expect(body.element_id).toBe(elementId);
      expect(store.fieldBindings).toHaveLength(1);
    });

    it('rejects binding to unpublished element', async () => {
      const elementId = randomUUID();
      store.elements.push({
        element_id: elementId,
        version: 1,
        element_code: 'semantic.draft.ref',
        lifecycle_status: 'DRAFT',
        privacy_classification: 'PUBLIC',
        code_list_binding_ref: null,
        idempotency_key: 'idem-draft-0001',
        correlation_id: randomUUID(),
        created_at: '2026-10-15T10:00:00.000Z',
        published_at: null,
        deprecated_at: null,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/bindings',
        headers: {
          authorization: 'Bearer officer-t1',
          'idempotency-key': key('bad-bind'),
          'content-type': 'application/json',
        },
        payload: {
          binding_id: randomUUID(),
          offering_id: randomUUID(),
          field_path: 'some.field',
          element_id: elementId,
          element_version: 1,
          idempotency_key: key('bad-bind'),
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('deletes a binding', async () => {
      const elementId = randomUUID();
      const bindingId = randomUUID();
      store.fieldBindings.push({
        tenant_id: T1,
        binding_id: bindingId,
        offering_id: randomUUID(),
        field_path: 'applicant.name',
        element_id: elementId,
        element_version: 1,
        idempotency_key: 'idem-del-0001',
        correlation_id: randomUUID(),
        created_at: '2026-10-15T10:00:00.000Z',
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/bindings/${bindingId}`,
        headers: { authorization: 'Bearer officer-t1' },
      });
      expect(res.statusCode).toBe(204);
      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/bindings/${bindingId}`,
        headers: { authorization: 'Bearer officer-t1' },
      });
      expect(getRes.statusCode).not.toBe(200);
    });
  });

  describe('Security / tenant isolation (INT-011)', () => {
    it('rejects unauthenticated request', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/elements' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects non-privileged admin creating element', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer officer-t1',
          'idempotency-key': key('officer-create'),
          'content-type': 'application/json',
        },
        payload: {
          element_id: randomUUID(),
          element_code: 'semantic.test.ref',
          privacy_classification: 'PUBLIC',
          idempotency_key: key('officer-create'),
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects privileged admin without MFA creating element', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer admin-nomfa',
          'idempotency-key': key('nomfa-create'),
          'content-type': 'application/json',
        },
        payload: {
          element_id: randomUUID(),
          element_code: 'semantic.test.ref',
          privacy_classification: 'PUBLIC',
          idempotency_key: key('nomfa-create'),
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects binding read without tenant context', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/bindings',
        headers: { authorization: 'Bearer admin-a' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects tenant-identifying headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer officer-t1',
          'x-tenant-id': 'some-tenant',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('tenant T1 binding not visible to T2 (FORCE RLS enforced in memory)', async () => {
      store.fieldBindings.push({
        tenant_id: T1,
        binding_id: randomUUID(),
        offering_id: randomUUID(),
        field_path: 'applicant.name',
        element_id: randomUUID(),
        element_version: 1,
        idempotency_key: 'idem-rls-0001',
        correlation_id: randomUUID(),
        created_at: '2026-10-15T10:00:00.000Z',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/bindings',
        headers: { authorization: 'Bearer officer-t2' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: unknown[] }>();
      expect(body.items).toHaveLength(0);
    });

    it('rejects OPA denied action', async () => {
      authorizer.denies.add('SEMANTIC_ELEMENT_READ');
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/v1/elements',
          headers: { authorization: 'Bearer officer-t1' },
        });
        expect(res.statusCode).toBe(403);
      } finally {
        authorizer.denies.delete('SEMANTIC_ELEMENT_READ');
      }
    });
  });

  describe('Invented policy rejection (SF-CON-SEMANTIC-ELEMENT)', () => {
    it('does not store or return government field meanings in element records', async () => {
      const elementId = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': key('opaque-ref'),
          'content-type': 'application/json',
        },
        payload: {
          element_id: elementId,
          element_code: 'semantic.applicant.full_name_ref',
          privacy_classification: 'PII',
          idempotency_key: key('opaque-ref'),
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<Record<string, unknown>>();
      expect(body).not.toHaveProperty('statutory_meaning');
      expect(body).not.toHaveProperty('government_policy');
      expect(body).not.toHaveProperty('eligibility_rule');
      const stored = store.elements[0];
      // stored may be undefined if failed; use optional chaining
      expect(stored).toBeDefined();
      expect(stored).not.toHaveProperty('statutory_meaning');
      expect(stored).not.toHaveProperty('government_policy');
    });
  });

  describe('Idempotency', () => {
    it('repeated POST with same idempotency key returns same result', async () => {
      const elementId = randomUUID();
      const idemKey = key('idem-repeat');
      const payload = {
        element_id: elementId,
        element_code: 'semantic.idem.ref',
        privacy_classification: 'PUBLIC',
        idempotency_key: idemKey,
      };
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': idemKey,
          'content-type': 'application/json',
        },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': idemKey,
          'content-type': 'application/json',
        },
        payload,
      });
      expect(res2.statusCode).toBe(201);
      expect(store.elements).toHaveLength(1);
    });
  });

  describe('Outbox events (audit trail)', () => {
    it('emits domain event on element creation', async () => {
      const elementId = randomUUID();
      await app.inject({
        method: 'POST',
        url: '/v1/elements',
        headers: {
          authorization: 'Bearer admin-a',
          'idempotency-key': key('ev-emit'),
          'content-type': 'application/json',
        },
        payload: {
          element_id: elementId,
          element_code: 'semantic.ev.ref',
          privacy_classification: 'PUBLIC',
          idempotency_key: key('ev-emit'),
        },
      });
      expect(store.outboxPlatform.length).toBeGreaterThanOrEqual(1);
    });
  });
});
