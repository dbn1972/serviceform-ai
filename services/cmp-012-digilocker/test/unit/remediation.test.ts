/**
 * SF-M07-004-REM remediation tests
 *
 * F01/SEC-F06 – credential ISSUED verification (CMP-022 port)
 * F05         – forged tenant header defence (full pattern set, SF-TEN-002)
 * F06         – adapter mode / binding mode cross-check (fail-closed in PRODUCTION)
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertNoTenantIdentifyingHeaders } from '../../src/context.js';
import { assertBindingPolicy } from '../../src/domain/simulation.js';
import { Cmp012Error } from '../../src/errors.js';
import { DigiLockerService } from '../../src/service/service.js';
import { SimulatedDigiLockerConnector } from '../../src/connectors/simulated-digilocker.js';
import { MemoryDigilockerRepository } from '../doubles/memory-repo.js';
import {
  AllowAllAuthorizer,
  FakeConnectorBindingPort,
  FakeCredentialVerificationPort,
  BINDING_ID,
  TENANT_A,
  TENANT_B,
  CREDENTIAL_ID,
  CONSENT_REF,
  PURPOSE_CODE,
  DOCUMENT_TYPE_REF,
  TEST_RUN_ID,
  simulatedBinding,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const validBody = {
  credential_id: CREDENTIAL_ID,
  consent_ref: CONSENT_REF,
  purpose_code: PURPOSE_CODE,
  document_type_ref: DOCUMENT_TYPE_REF,
  test_run_id: TEST_RUN_ID,
};

// ─── F01 / SEC-F06: credential ISSUED verification ───────────────────────────

describe('F01/SEC-F06: credential verification via CMP-022 port', () => {
  it('publish succeeds when credential is ISSUED, signed, and belongs to tenant', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(201);
    expect(h.credentialVerification.calls).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 when credential is not found (fail-closed)', async () => {
    const h = makeHarness();
    h.credentialVerification.result = {
      found: false,
      tenantId: null,
      lifecycle: null,
      signed: false,
    };
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(404);
    const body = r.body as Record<string, unknown>;
    expect(body['error_code']).toBe('SF-SYS-002');
  });

  it('returns 403 when credential belongs to a different tenant (fail-closed)', async () => {
    const h = makeHarness();
    h.credentialVerification.result = {
      found: true,
      tenantId: TENANT_B,
      lifecycle: 'ISSUED',
      signed: true,
    };
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(403);
    const body = r.body as Record<string, unknown>;
    expect(body['error_code']).toBe('SF-TEN-002');
  });

  it('returns 400 when credential is not signed (fail-closed)', async () => {
    const h = makeHarness();
    h.credentialVerification.result = {
      found: true,
      tenantId: TENANT_A,
      lifecycle: 'ISSUED',
      signed: false,
    };
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(400);
    const body = r.body as Record<string, unknown>;
    expect(body['error_code']).toBe('SF-SYS-003');
  });

  it('returns 400 when credential lifecycle is DRAFT, not ISSUED (fail-closed)', async () => {
    const h = makeHarness();
    h.credentialVerification.result = {
      found: true,
      tenantId: TENANT_A,
      lifecycle: 'DRAFT',
      signed: true,
    };
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(400);
    const body = r.body as Record<string, unknown>;
    expect(body['error_code']).toBe('SF-SYS-003');
  });

  it('returns 400 when credential lifecycle is REVOKED (fail-closed)', async () => {
    const h = makeHarness();
    h.credentialVerification.result = {
      found: true,
      tenantId: TENANT_A,
      lifecycle: 'REVOKED',
      signed: true,
    };
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(400);
  });

  it('returns 503 when CMP-022 port throws (fail-closed, no silent fallback)', async () => {
    const h = makeHarness();
    h.credentialVerification.failure = new Error('cmp-022 unavailable');
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(503);
    const body = r.body as Record<string, unknown>;
    expect(body['error_code']).toBe('SF-SYS-004');
  });
});

// ─── F05: forged tenant header defence ───────────────────────────────────────

describe('F05: forged tenant header defence (SF-TEN-002 full pattern set)', () => {
  const cases: Array<[string, Record<string, string>]> = [
    // Legacy exact-match names (must still work)
    ['x-real-tenant-id', { 'x-real-tenant-id': 'evil' }],
    ['x-bypass-rls', { 'x-bypass-rls': 'true' }],
    ['x-override-tenant', { 'x-override-tenant': 'evil' }],
    // New: x-tenant-* prefix
    ['x-tenant-id', { 'x-tenant-id': 'evil' }],
    ['x-tenant-override', { 'x-tenant-override': 'evil' }],
    ['x-tenant-scope', { 'x-tenant-scope': 'evil' }],
    // New: x-sf-* prefix
    ['x-sf-tenant', { 'x-sf-tenant': 'evil' }],
    ['x-sf-scope', { 'x-sf-scope': 'evil' }],
    ['x-sf-internal-tenant', { 'x-sf-internal-tenant': 'evil' }],
    // New: x-forwarded-tenant
    ['x-forwarded-tenant', { 'x-forwarded-tenant': 'evil' }],
    // New: Forwarded with tenant= token
    ['Forwarded tenant= param', { forwarded: 'host=example.com;tenant=evil' }],
    ['Forwarded with spaces', { Forwarded: 'tenant = evil, host=example.com' }],
  ];

  for (const [label, headers] of cases) {
    it(`refuses header: ${label}`, () => {
      expect(() => assertNoTenantIdentifyingHeaders(headers)).toThrow(Cmp012Error);
    });
  }

  it('does not refuse legitimate non-tenant headers', () => {
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        'content-type': 'application/json',
        authorization: 'Bearer token',
        'idempotency-key': randomUUID(),
        'x-request-id': randomUUID(),
        'x-correlation-id': randomUUID(),
        'accept-language': 'en',
        forwarded: 'for=1.2.3.4;host=example.com;proto=https',
      }),
    ).not.toThrow();
  });

  it('refuses via API handler and returns 403 for x-tenant-id header', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', validBody, {
      headers: { 'x-tenant-id': 'evil' },
    });
    expect(r.status).toBe(403);
    const body = r.body as Record<string, unknown>;
    expect(body['error_code']).toBe('SF-TEN-002');
  });

  it('refuses via API handler and returns 403 for x-sf-tenant header', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', validBody, {
      headers: { 'x-sf-tenant': 'evil' },
    });
    expect(r.status).toBe(403);
  });

  it('refuses via API handler for Forwarded with tenant= param', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', validBody, {
      headers: { forwarded: 'tenant=evil;host=example.com' },
    });
    expect(r.status).toBe(403);
  });
});

// ─── F06: adapter mode / binding mode mismatch ───────────────────────────────

describe('F06: adapter mode must match binding mode (fail-closed)', () => {
  it('fails-closed when SIMULATED adapter is injected but binding is REAL in PRODUCTION', async () => {
    // Build a service where assertBindingPolicy would pass (REAL in PRODUCTION)
    // but the adapter is SIMULATED — must be rejected before any API call.
    const repo = new MemoryDigilockerRepository();
    const realBinding = simulatedBinding({
      mode: 'REAL',
      environment: 'PRODUCTION',
      critical: true,
      secret_ref: 'aws-sm://prod/digilocker',
    });
    const connectorBinding = new FakeConnectorBindingPort('PRODUCTION' as never);
    connectorBinding.binding = realBinding;

    const simulationMarker = {
      simulation: true as const,
      scenario: 'digilocker_publish',
      test_run_id: TEST_RUN_ID,
      connector_binding_id: BINDING_ID,
      environment: 'LOCAL' as const,
    };

    // Adapter is SimulatedDigiLockerConnector (mode='SIMULATED') but binding says REAL.
    // The mode cross-check must catch this and throw SF-INT-001 fail-closed.
    const simulatedAdapter = new SimulatedDigiLockerConnector(simulationMarker);

    const service = new DigiLockerService({
      repo,
      authorizer: new AllowAllAuthorizer(),
      connectorBinding,
      credentialVerification: new FakeCredentialVerificationPort(TENANT_A),
      digilockerApi: simulatedAdapter,
      runtimeEnvironment: 'PRODUCTION',
      clock: () => new Date('2026-10-14T05:00:00Z'),
    });

    const ctx = {
      tenant_id: TENANT_A,
      cell_id: 'cell-01',
      actor: { type: 'SYSTEM' as const, id: randomUUID() },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY' as const,
      correlation_id: randomUUID(),
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    };

    const idem = {
      key: randomUUID(),
      endpoint: 'POST /v1/digilocker-publish',
      fingerprint: `sha256:${'a'.repeat(64)}`,
    };

    await expect(
      service.publishCredential(
        ctx,
        {
          credential_id: CREDENTIAL_ID,
          consent_ref: CONSENT_REF,
          purpose_code: PURPOSE_CODE,
          document_type_ref: DOCUMENT_TYPE_REF,
          test_run_id: TEST_RUN_ID,
        },
        idem,
      ),
    ).rejects.toThrow(Cmp012Error);
  });

  it('assertBindingPolicy still rejects critical SIMULATED binding in PRODUCTION', () => {
    const binding = simulatedBinding({
      mode: 'SIMULATED',
      environment: 'PRODUCTION',
      critical: true,
    });
    expect(() =>
      assertBindingPolicy(binding, { tenantId: TENANT_A, runtimeEnvironment: 'PRODUCTION' }),
    ).toThrow(Cmp012Error);
  });

  it('mode mismatch error is SF-INT-001 (fail-closed integration error)', async () => {
    const repo = new MemoryDigilockerRepository();
    const sandboxBinding = simulatedBinding({
      mode: 'SANDBOX',
      environment: 'DEVELOPMENT',
      critical: false,
      secret_ref: 'aws-sm://dev/digilocker',
    });
    const connectorBinding = new FakeConnectorBindingPort('DEVELOPMENT' as never);
    connectorBinding.binding = sandboxBinding;

    const simulationMarker = {
      simulation: true as const,
      scenario: 'digilocker_publish',
      test_run_id: TEST_RUN_ID,
      connector_binding_id: BINDING_ID,
      environment: 'LOCAL' as const,
    };

    // Adapter mode is SIMULATED but binding mode is SANDBOX
    const service = new DigiLockerService({
      repo,
      authorizer: new AllowAllAuthorizer(),
      connectorBinding,
      credentialVerification: new FakeCredentialVerificationPort(TENANT_A),
      digilockerApi: new SimulatedDigiLockerConnector(simulationMarker),
      runtimeEnvironment: 'DEVELOPMENT',
      clock: () => new Date('2026-10-14T05:00:00Z'),
    });

    const ctx = {
      tenant_id: TENANT_A,
      cell_id: 'cell-01',
      actor: { type: 'SYSTEM' as const, id: randomUUID() },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY' as const,
      correlation_id: randomUUID(),
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    };

    await expect(
      service.publishCredential(
        ctx,
        {
          credential_id: CREDENTIAL_ID,
          consent_ref: CONSENT_REF,
          purpose_code: PURPOSE_CODE,
          document_type_ref: DOCUMENT_TYPE_REF,
          test_run_id: TEST_RUN_ID,
        },
        {
          key: randomUUID(),
          endpoint: 'POST /v1/digilocker-publish',
          fingerprint: `sha256:${'b'.repeat(64)}`,
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-INT-001' });
  });
});
