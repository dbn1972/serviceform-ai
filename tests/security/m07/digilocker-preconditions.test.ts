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
  it('CLOSED M07-SEC-F06 (ISSUED): publish refuses an unknown credential id via CMP-022 port', async () => {
    const h = h012();
    h.credentialVerification.result = {
      found: false,
      tenantId: null,
      lifecycle: null,
      signed: false,
    };
    const neverIssued = randomUUID();
    const unverifiedConsent = randomUUID();
    const res = await h.call('POST', '/v1/digilocker-publish', {
      credential_id: neverIssued,
      consent_ref: unverifiedConsent,
      purpose_code: PURPOSE_CODE,
      document_type_ref: DOCUMENT_TYPE_REF,
      test_run_id: 'test-run-001',
    });
    expect(res.status).toBe(404);
    expect((res.body as Body)['error_code']).toBe('SF-SYS-002');
    expect([...h.repo.stores.values()][0]?.publishRecords.size ?? 0).toBe(0);
  });

  it('RESIDUAL M07-SEC-F06 (consent): CMP-012 still has no CMP-030 consent verification port', () => {
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
      'credentialVerification',
      'digilockerApi',
      'runtimeEnvironment',
      'clock',
    ]);
    expect(keys).not.toContain('consentVerification');
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
