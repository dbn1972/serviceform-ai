import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeHarness as h012 } from '../../../services/cmp-012-digilocker/test/doubles/harness.js';
import {
  DOCUMENT_TYPE_REF,
  PURPOSE_CODE,
} from '../../../services/cmp-012-digilocker/test/doubles/fixtures.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('SF-M07-SEC CMP-012 publish preconditions (consent/purpose + ISSUED)', () => {
  it('FINDING M07-SEC-F06: publish succeeds for an unknown credential id and an unverified consent_ref', async () => {
    const h = h012();
    const neverIssued = randomUUID();
    const unverifiedConsent = randomUUID();
    const res = await h.call('POST', '/v1/digilocker-publish', {
      credential_id: neverIssued,
      consent_ref: unverifiedConsent,
      purpose_code: PURPOSE_CODE,
      document_type_ref: DOCUMENT_TYPE_REF,
      test_run_id: 'test-run-001',
    });
    // Characterises current behaviour: nothing checks CMP-022 (ISSUED, same tenant) or CMP-030
    // (consent active for purpose) before the connector call; the row records ISSUED regardless.
    expect(res.status).toBe(201);
    expect((res.body as Body)['publish_status']).toBe('PUBLISHED');
    const row = [...h.repo.stores.values()][0]?.publishRecords.values().next().value;
    expect(row?.credential_lifecycle_status_at_request).toBe('ISSUED');
    expect(row?.consent_ref).toBe(unverifiedConsent);
  });

  it('CMP-012 service dependencies expose no credential-status or consent port (source evidence)', () => {
    const svc = readFileSync(
      join(ROOT, 'services/cmp-012-digilocker/src/service/service.ts'),
      'utf8',
    );
    const deps = svc.slice(
      svc.indexOf('interface DigiLockerServiceDeps'),
      svc.indexOf('}', svc.indexOf('interface DigiLockerServiceDeps')),
    );
    const keys = [...deps.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      'repo',
      'authorizer',
      'connectorBinding',
      'digilockerApi',
      'runtimeEnvironment',
      'clock',
    ]);
    const schema = readFileSync(
      join(ROOT, 'contracts/m07/schemas/digilocker-publish.schema.json'),
      'utf8',
    );
    expect(schema).toMatch(/Only ISSUED credentials are published/);
    expect(schema).toMatch(/Requires consent and purpose refs \(CMP-030\)/);
  });

  it('PRODUCTION never runs the SIMULATED DigiLocker connector', async () => {
    const h = h012({ env: 'CI' });
    expect((await h.call('GET', `/v1/digilocker-publish/${randomUUID()}`)).status).toBe(404);
    const { assertBindingPolicy } =
      await import('../../../services/cmp-012-digilocker/src/domain/simulation.js');
    const binding = {
      connector_binding_id: randomUUID(),
      tenant_id: null,
      connector_type: 'DIGILOCKER',
      mode: 'SIMULATED' as const,
      environment: 'PRODUCTION' as const,
      critical: true,
      secret_ref: null,
      simulator_version: '1.0.0',
    };
    expect(() =>
      assertBindingPolicy(binding, { tenantId: randomUUID(), runtimeEnvironment: 'PRODUCTION' }),
    ).toThrow();
    expect(() =>
      assertBindingPolicy(
        { ...binding, critical: false },
        { tenantId: randomUUID(), runtimeEnvironment: 'PRODUCTION' },
      ),
    ).toThrow();
    const foreign = { ...binding, environment: 'LOCAL' as const, tenant_id: randomUUID() };
    expect(() =>
      assertBindingPolicy(foreign, { tenantId: randomUUID(), runtimeEnvironment: 'LOCAL' }),
    ).toThrow(/Cross-tenant|SF-TEN-002/);
  });
});
