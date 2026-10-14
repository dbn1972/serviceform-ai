import { describe, expect, it } from 'vitest';
import {
  APP_1,
  conforms,
  ctxFor,
  DL_BINDING_ID,
  finding,
  must,
  T1,
  TEST_RUN_ID,
  type DeploymentEnvironment,
} from './support/fixtures.js';
import { issue, publish } from './support/flow.js';
import {
  buildStack,
  simulatedDigiLocker,
  type DigiLockerApi,
  type Stack,
} from './support/wiring.js';

/**
 * INT-013 re-verification for M07: eSign (CMP-022 signing adapter result) and DigiLocker
 * (CMP-012 connector binding) modes. PRODUCTION + critical + non-REAL must fail closed and
 * nothing may be recorded as SIGNED / PUBLISHED.
 */

async function issueRaw(s: Stack, key = 'issue:mode:1') {
  s.casePins.approve(T1, APP_1);
  return s.call(
    'CMP-022',
    'POST',
    '/v1/credentials',
    { application_id: APP_1, issuance_key: key },
    { ctx: ctxFor(T1, 'SYSTEM') },
  );
}

function onlyCredential(s: Stack) {
  const rows = [...s.repos.credential.tenant(T1).credentials.values()];
  expect(rows.length).toBe(1);
  return must(rows[0]);
}

function detailCodes(body: { details?: Array<{ code: string }> }): string[] {
  return (body.details ?? []).map((d) => d.code);
}

describe('INT-013 eSign modes at CMP-022', () => {
  for (const env of ['UAT', 'PREPROD', 'PRODUCTION'] as const) {
    it(`refuses a SIMULATED eSign result in ${env} fail-closed: no SIGNED record, not issued, registry untouched`, async () => {
      const s = buildStack({ credentialEnvironment: env });
      const res = await issueRaw(s);
      expect(res.body.error_code).toBe('SF-CRED-001');
      expect(detailCodes(res.body)).toContain('SIMULATED_CONNECTOR_FORBIDDEN');
      expect(conforms('error-response', res.body).errors).toBe('');
      expect(onlyCredential(s).lifecycle_status).toBe('GENERATED');
      expect(s.repos.credential.tenant(T1).signing.length).toBe(0);
      expect(s.registryBridge.calls).toBe(0);
      expect(s.repos.registry.tenant(T1).entries.size).toBe(0);
    });
  }

  it('defaults to PRODUCTION when no environment is configured, so SIMULATED eSign is refused', async () => {
    const s = buildStack({ credentialEnvironment: 'DEFAULT' });
    const res = await issueRaw(s);
    expect(detailCodes(res.body)).toContain('SIMULATED_CONNECTOR_FORBIDDEN');
    expect(onlyCredential(s).lifecycle_status).toBe('GENERATED');
  });

  for (const env of ['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE'] as const) {
    it(`accepts SIMULATED eSign in ${env} only with a matching simulation marker`, async () => {
      const s = buildStack({ credentialEnvironment: env });
      s.signer.markerEnvironment = env;
      const res = await issueRaw(s);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const [rec] = s.repos.credential.tenant(T1).signing;
      expect(must(rec).simulation_marker).toMatchObject({ simulation: true, environment: env });
    });
  }

  it('refuses SIMULATED eSign without a simulation marker', async () => {
    const s = buildStack();
    s.signer.omitMarker = true;
    const res = await issueRaw(s);
    expect(detailCodes(res.body)).toContain('SIMULATION_MARKER_INVALID');
    expect(s.repos.credential.tenant(T1).signing.length).toBe(0);
  });

  it('refuses a simulation marker whose environment differs from the deployment environment', async () => {
    const s = buildStack({ credentialEnvironment: 'CI' });
    s.signer.markerEnvironment = 'SIT';
    const res = await issueRaw(s);
    expect(detailCodes(res.body)).toContain('SIMULATION_MARKER_INVALID');
  });

  it('refuses a REAL eSign result that carries a simulation marker', async () => {
    const s = buildStack({ credentialEnvironment: 'PRODUCTION' });
    s.signer.mode = 'REAL';
    const original = s.signer.sign.bind(s.signer);
    s.signer.sign = async (ctx, req) => ({
      ...(await original(ctx, req)),
      simulation_marker: {
        simulation: true,
        scenario: 'esign_success',
        test_run_id: TEST_RUN_ID,
        connector_binding_id: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
        environment: 'CI',
      },
    });
    const res = await issueRaw(s);
    expect(detailCodes(res.body)).toContain('SIMULATION_MARKER_FORBIDDEN');
    expect(onlyCredential(s).lifecycle_status).toBe('GENERATED');
  });

  it('records a REAL eSign result in PRODUCTION without a marker (mode-aware, not blanket refusal)', async () => {
    const s = buildStack({ credentialEnvironment: 'PRODUCTION' });
    s.signer.mode = 'REAL';
    const res = await issueRaw(s);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const records = await s.call(
      'CMP-022',
      'GET',
      `/v1/credentials/${res.body.credential_id as string}/signing-records`,
    );
    const [rec] = records.body.signing_records as Array<Record<string, unknown>>;
    expect(rec).toMatchObject({ connector_mode: 'REAL', signing_result: 'SIGNED' });
    expect(rec).not.toHaveProperty('simulation_marker');
    expect(conforms('m07/signing-record', rec).errors).toBe('');
  });

  it('OBSERVATION M07-INT-O1 (characterised): CMP-022 accepts a SANDBOX eSign result in PRODUCTION; criticality is enforced only by the CMP-037 binding resolver', async () => {
    const s = buildStack({ credentialEnvironment: 'PRODUCTION' });
    s.signer.mode = 'SANDBOX';
    const res = await issueRaw(s);
    expect(res.status).toBe(201);
    expect(s.repos.credential.tenant(T1).signing[0]?.connector_mode).toBe('SANDBOX');
  });
});

function prodStack(dlEnv: DeploymentEnvironment = 'PRODUCTION', api?: DigiLockerApi) {
  return buildStack({
    credentialEnvironment: 'CI',
    digilockerEnvironment: dlEnv,
    ...(api ? { digilockerApi: api } : {}),
  });
}

async function refusedPublish(s: Stack, credentialId: string, code: string, extra = {}) {
  const res = await publish(s, T1, credentialId, extra);
  expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
  expect(res.body.error_code).toBe('SF-INT-001');
  expect(detailCodes(res.body)).toContain(code);
  expect(s.digilockerApi.calls.length).toBe(0);
  expect(s.repos.digilocker.tenant(T1).publishRecords.size).toBe(0);
  return res;
}

describe('INT-013 DigiLocker modes at CMP-012', () => {
  it('PRODUCTION + critical + SIMULATED binding fails closed before any connector call', async () => {
    const s = prodStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(
      T1,
      s.bindings.simulated(T1, { environment: 'PRODUCTION', critical: true }),
    );
    await refusedPublish(s, credentialId, 'CRITICAL_NON_REAL_IN_PRODUCTION');
    expect(
      (await s.call('CMP-022', 'GET', `/v1/credentials/${credentialId}`)).body.lifecycle_status,
    ).toBe('ISSUED');
  });

  it('PRODUCTION + critical + SANDBOX binding fails closed', async () => {
    const s = prodStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(
      T1,
      s.bindings.simulated(T1, {
        environment: 'PRODUCTION',
        mode: 'SANDBOX',
        secret_ref: 'aws-sm://sf/m07-int/digilocker-sandbox',
      }),
    );
    await refusedPublish(s, credentialId, 'CRITICAL_NON_REAL_IN_PRODUCTION');
  });

  it('PRODUCTION + non-critical + SIMULATED binding is still refused', async () => {
    const s = prodStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(
      T1,
      s.bindings.simulated(T1, { environment: 'PRODUCTION', critical: false }),
    );
    await refusedPublish(s, credentialId, 'SIMULATED_ENVIRONMENT_REFUSED');
  });

  for (const env of ['UAT', 'PREPROD'] as const) {
    it(`SIMULATED binding in ${env} is refused`, async () => {
      const s = prodStack(env);
      const { credentialId } = await issue(s);
      s.bindings.byTenant.set(T1, s.bindings.simulated(T1, { environment: env, critical: false }));
      await refusedPublish(s, credentialId, 'SIMULATED_ENVIRONMENT_REFUSED');
    });
  }

  it('a CI-environment SIMULATED binding is refused by a PRODUCTION runtime (environment mismatch)', async () => {
    const s = prodStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(T1, s.bindings.simulated(T1, { environment: 'CI' }));
    await refusedPublish(s, credentialId, 'CONNECTOR_ENVIRONMENT_MISMATCH');
  });

  it('a REAL binding in CI is refused (LOCAL/CI must be SIMULATED)', async () => {
    const s = buildStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(
      T1,
      s.bindings.simulated(T1, { mode: 'REAL', secret_ref: 'aws-sm://sf/m07-int/digilocker' }),
    );
    await refusedPublish(s, credentialId, 'NON_SIMULATED_IN_LOCAL_OR_CI_REFUSED');
  });

  it('a REAL PRODUCTION binding without a secret reference is refused', async () => {
    const s = prodStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(
      T1,
      s.bindings.simulated(T1, {
        environment: 'PRODUCTION',
        mode: 'REAL',
        simulator_version: undefined,
      }),
    );
    await refusedPublish(s, credentialId, 'SECRET_REF_REQUIRED');
  });

  it('SIMULATED publish without test_run_id cannot build a marker and is refused', async () => {
    const s = buildStack();
    const { credentialId } = await issue(s);
    await refusedPublish(s, credentialId, 'SIMULATION_MARKER_UNAVAILABLE', {
      test_run_id: undefined,
    });
  });

  it('a non-DIGILOCKER binding type is refused', async () => {
    const s = buildStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(T1, s.bindings.simulated(T1, { connector_type: 'ESIGN' }));
    await refusedPublish(s, credentialId, 'CONNECTOR_TYPE_MISMATCH');
  });

  it('a missing binding is refused (no implicit default connector)', async () => {
    const s = buildStack();
    const { credentialId } = await issue(s);
    s.bindings.byTenant.set(T1, null);
    await refusedPublish(s, credentialId, 'CONNECTOR_BINDING_NOT_FOUND');
  });

  it('SIMULATED publish in CI persists a conformant SF-CON-SIMULATION-MARKER on the record', async () => {
    const s = buildStack();
    const { credentialId } = await issue(s);
    const res = await publish(s, T1, credentialId);
    expect(res.status).toBe(201);
    const [row] = [...s.repos.digilocker.tenant(T1).publishRecords.values()];
    expect(must(row).connector_mode).toBe('SIMULATED');
    expect(must(row).simulation_marker).toEqual({
      simulation: true,
      scenario: 'digilocker_publish',
      test_run_id: TEST_RUN_ID,
      connector_binding_id: DL_BINDING_ID,
      environment: 'CI',
    });
    expect(s.digilockerApi.calls[0]?.simulationMarker?.environment).toBe('CI');
  });

  it('OBSERVATION M07-INT-O2 (characterised): CMP-012 defaults runtimeEnvironment to LOCAL when unset (CMP-022 defaults to PRODUCTION)', async () => {
    const s = buildStack({ digilockerEnvironment: 'DEFAULT' });
    const { credentialId } = await issue(s);
    const res = await publish(s, T1, credentialId);
    expect(res.status).toBe(201);
    expect(res.body.connector_mode).toBe('SIMULATED');
  });

  finding(
    'FINDING M07-INT-F06: CMP-012 must refuse when the injected DigiLocker adapter mode (SIMULATED) differs from a REAL PRODUCTION binding',
    async () => {
      const s = prodStack('PRODUCTION', simulatedDigiLocker('CI'));
      const { credentialId } = await issue(s);
      s.bindings.byTenant.set(
        T1,
        s.bindings.simulated(T1, {
          environment: 'PRODUCTION',
          mode: 'REAL',
          critical: true,
          secret_ref: 'aws-sm://sf/m07-int/digilocker',
          simulator_version: undefined,
        }),
      );
      expect(s.digilockerApi.mode).toBe('SIMULATED');
      const res = await publish(s, T1, credentialId, { test_run_id: undefined });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(s.digilockerApi.calls.length).toBe(0);
      expect(s.repos.digilocker.tenant(T1).publishRecords.size).toBe(0);
    },
  );
});
