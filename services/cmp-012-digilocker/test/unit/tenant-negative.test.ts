import { describe, expect, it } from 'vitest';
import { makeHarness } from '../doubles/harness.js';
import {
  CREDENTIAL_ID,
  CONSENT_REF,
  PURPOSE_CODE,
  DOCUMENT_TYPE_REF,
  TENANT_B,
} from '../doubles/fixtures.js';

const validBody = {
  credential_id: CREDENTIAL_ID,
  consent_ref: CONSENT_REF,
  purpose_code: PURPOSE_CODE,
  document_type_ref: DOCUMENT_TYPE_REF,
  test_run_id: 'test-run-001',
};

describe('tenant isolation (tenant-negative tests)', () => {
  it('a tenant cannot see another tenant publish record', async () => {
    const h = makeHarness();
    const created = await h.call('POST', '/v1/digilocker-publish', validBody);
    const id = (created.body as Record<string, unknown>)['publish_request_id'] as string;

    // Switch to TENANT_B context
    h.state.ctx = {
      ...h.state.ctx,
      tenant_id: TENANT_B,
    };

    const r = await h.call('GET', `/v1/digilocker-publish/${id}`);
    // TENANT_B has no records; should 404 not leak TENANT_A record
    expect(r.status).toBe(404);
  });

  it('publish for TENANT_A does not appear in TENANT_B store', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/digilocker-publish', validBody);
    const storeTenantB = h.repo.stores.get(TENANT_B);
    // TENANT_B store should not have been touched
    expect(storeTenantB?.publishRecords.size ?? 0).toBe(0);
  });

  it('returns 403 when authorizer denies', async () => {
    const { AllowAllAuthorizer } = await import('../doubles/fixtures.js');
    const auth = new AllowAllAuthorizer();
    auth.mode = 'deny';
    const { DigiLockerService } = await import('../../src/service/service.js');
    const { MemoryDigilockerRepository } = await import('../doubles/memory-repo.js');
    const { SimulatedDigiLockerConnector } =
      await import('../../src/connectors/simulated-digilocker.js');
    const { createDigilockerApi } = await import('../../src/api/handler.js');
    const { FakeConnectorBindingPort, FakeCredentialVerificationPort, BINDING_ID, TENANT_A, ACTOR_SYSTEM, TEST_RUN_ID } =
      await import('../doubles/fixtures.js');
    const { randomUUID } = await import('node:crypto');
    const simulationMarker = {
      simulation: true as const,
      scenario: 'digilocker_publish',
      test_run_id: TEST_RUN_ID,
      connector_binding_id: BINDING_ID,
      environment: 'LOCAL' as const,
    };
    const repo = new MemoryDigilockerRepository();
    const connectorBinding = new FakeConnectorBindingPort('LOCAL');
    const credentialVerification = new FakeCredentialVerificationPort(TENANT_A);
    const digilockerApi = new SimulatedDigiLockerConnector(simulationMarker);
    const service = new DigiLockerService({
      repo,
      authorizer: auth,
      connectorBinding,
      credentialVerification,
      digilockerApi,
      runtimeEnvironment: 'LOCAL',
      clock: () => new Date('2026-10-14T05:00:00Z'),
    });
    const api = createDigilockerApi({
      service,
      resolveContext: async () => ({
        tenant_id: TENANT_A,
        cell_id: 'cell-01',
        actor: { type: 'SYSTEM', id: ACTOR_SYSTEM },
        roles: [],
        jurisdiction_ids: [],
        auth_assurance: 'WORKLOAD_IDENTITY',
        correlation_id: randomUUID(),
        trace_id: '0af7651916cd43dd8448eb211c80319c',
      }),
    });
    const r = await api.handle({
      method: 'POST',
      path: '/v1/digilocker-publish',
      headers: { 'idempotency-key': randomUUID() },
      body: validBody,
    });
    expect(r.status).toBe(403);
  });

  it('refuses x-bypass-rls header (tenant leak protection)', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', validBody, {
      headers: { 'x-bypass-rls': 'true' },
    });
    expect(r.status).toBe(403);
  });

  it('returns 401 when no tenant context', async () => {
    const { createDigilockerApi } = await import('../../src/api/handler.js');
    const { DigiLockerService } = await import('../../src/service/service.js');
    const { MemoryDigilockerRepository } = await import('../doubles/memory-repo.js');
    const { AllowAllAuthorizer, FakeConnectorBindingPort, FakeCredentialVerificationPort, BINDING_ID, TENANT_A, TEST_RUN_ID } =
      await import('../doubles/fixtures.js');
    const { SimulatedDigiLockerConnector } =
      await import('../../src/connectors/simulated-digilocker.js');
    const { randomUUID } = await import('node:crypto');
    const simulationMarker = {
      simulation: true as const,
      scenario: 'digilocker_publish',
      test_run_id: TEST_RUN_ID,
      connector_binding_id: BINDING_ID,
      environment: 'LOCAL' as const,
    };
    const repo = new MemoryDigilockerRepository();
    const service = new DigiLockerService({
      repo,
      authorizer: new AllowAllAuthorizer(),
      connectorBinding: new FakeConnectorBindingPort('LOCAL'),
      credentialVerification: new FakeCredentialVerificationPort(TENANT_A),
      digilockerApi: new SimulatedDigiLockerConnector(simulationMarker),
      runtimeEnvironment: 'LOCAL',
      clock: () => new Date(),
    });
    const api = createDigilockerApi({
      service,
      resolveContext: async () => ({
        tenant_id: null,
        cell_id: 'cell-01',
        actor: { type: 'SYSTEM', id: randomUUID() },
        roles: [],
        jurisdiction_ids: [],
        auth_assurance: 'NONE',
        correlation_id: randomUUID(),
        trace_id: '0af7651916cd43dd8448eb211c80319c',
      }),
    });
    const r = await api.handle({
      method: 'POST',
      path: '/v1/digilocker-publish',
      headers: { 'idempotency-key': randomUUID() },
      body: validBody,
    });
    expect(r.status).toBe(401);
  });
});
