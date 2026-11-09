import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestContext } from '@serviceform/contracts';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  CaseIssuancePinsBridge,
  LabDigiLockerBinding,
  LabIssuanceCoordinator,
  RegistryBridge,
  SimulatedEsignBridge,
  parseIssuanceFixture,
  registerLabIssuanceRoutes,
  workloadContext,
  type CaseServiceLike,
  type LabIssuanceConfig,
  type NeutralApiLike,
} from '../src/platform/issuance.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = JSON.parse(
  readFileSync(join(ROOT, 'fixtures/lab/platform/issuance.json'), 'utf8'),
) as Record<string, unknown>;
const TENANT = '0d15ba00-0001-4000-8000-0d15ba0000d1';
const TSB = '0d15ba00-0002-4000-8000-0d15ba0000d2';
const TEMPLATE_VERSION = '0d15ba00-0016-4000-8000-0d15ba000016';
const APP_ID = '0d15ba00-0a00-4000-8000-0d15ba000a01';
const CRED_ID = '0d15ba00-0c22-4000-8000-0d15ba000c22';
const OFFICER = '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f';
const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';

const cfg = (): LabIssuanceConfig => parseIssuanceFixture(RAW, TENANT, 'LOCAL', 'b3-unit-run');

const ctx = (type: 'OFFICER' | 'CITIZEN', id: string): RequestContext => ({
  tenant_id: TENANT,
  cell_id: 'lab-cell-1',
  actor: { type, id },
  roles: [],
  jurisdiction_ids: [],
  auth_assurance: 'OTP',
  correlation_id: '0d15ba00-cc00-4000-8000-0d15ba00cc00',
  trace_id: '0d15ba00cc0040008000',
});

function caseDouble(initial: string) {
  const state = { value: initial, version: 7 };
  const commands: string[] = [];
  const transitions = [
    {
      transition_id: '0d15ba00-7700-4000-8000-0d15ba007700',
      command: 'RECORD_APPROVED',
      to_state: 'APPROVED',
      actor_type: 'OFFICER',
    },
  ];
  const view = () => ({
    application_id: APP_ID,
    state: state.value,
    aggregate_version: state.version,
    pins: { tenant_service_binding_id: TSB, credential_template_version_id: TEMPLATE_VERSION },
  });
  const cases: CaseServiceLike = {
    getApplication: async () => ({ status: 200, body: { application: view() } }),
    listTransitions: async () => ({ status: 200, body: { transitions } }),
    executeCommand: async (_c, _id, body) => {
      const cmd = (body as { command: string }).command;
      commands.push(cmd);
      state.value = cmd === 'ENTER_SIGNING_PENDING' ? 'SIGNING_PENDING' : 'ISSUED';
      state.version += 1;
      return { status: 200, body: { application: view() } };
    },
  };
  return { cases, commands, state, transitions };
}

function apiDouble(
  handler: (req: Parameters<NeutralApiLike['handle']>[0]) => { status: number; body: unknown },
) {
  const calls: { method: string; path: string; key?: string; ctx: RequestContext }[] = [];
  const factory = (c: RequestContext): NeutralApiLike => ({
    handle: async (req) => {
      const key = req.headers['idempotency-key'];
      calls.push({
        method: req.method,
        path: req.path,
        ...(typeof key === 'string' ? { key } : {}),
        ctx: c,
      });
      return handler(req);
    },
  });
  return { factory, calls };
}

function lab(initial: string, publish: 'PUBLISHED' | 'HTTP_FAIL' = 'PUBLISHED') {
  const config = cfg();
  const c = caseDouble(initial);
  let issued = false;
  const records: Record<string, unknown>[] = [];
  const credential = apiDouble((req) => {
    if (req.method === 'GET') {
      return {
        status: 200,
        body: {
          credentials: issued ? [{ credential_id: CRED_ID, lifecycle_status: 'ISSUED' }] : [],
        },
      };
    }
    if (req.path === '/v1/credentials') {
      issued = true;
      return { status: 201, body: { credential_id: CRED_ID, lifecycle_status: 'ISSUED' } };
    }
    return { status: 201, body: {} };
  });
  const digilocker = apiDouble((req) => {
    if (req.method === 'GET') return { status: 200, body: { publish_records: [...records] } };
    if (publish === 'HTTP_FAIL') {
      return { status: 502, body: { error_code: 'SF-INT-001' } };
    }
    const record = {
      publish_request_id: '0d15ba00-0c12-4000-8000-0d15ba000c99',
      credential_id: CRED_ID,
      publish_status: 'PUBLISHED',
      connector_mode: 'SIMULATED',
      provider_transaction_ref: 'sim-dl-0001',
    };
    records.unshift(record);
    return { status: 201, body: record };
  });
  const coordinator = new LabIssuanceCoordinator({
    config,
    cases: c.cases,
    credentialApi: credential.factory,
    digilockerApi: digilocker.factory,
    workload: () => workloadContext(config, 'lab-cell-1'),
  });
  return { coordinator, credential, digilocker, ...c };
}

// REQ SF-M10-B-3 / CCR-M10-003: SIMULATED post-approval issuance on the SAMPLE_LAB host.
describe('issuance fixture (LOCAL/CI only, SIMULATED, synthetic consent)', () => {
  it('parses the SAMPLE_LAB fixture for its tenant', () => {
    const c = cfg();
    expect(c.environment).toBe('LOCAL');
    expect(c.workload.roles).toEqual(['SAMPLE_LAB_ISSUANCE_WORKLOAD']);
    expect(c.publish.purpose_code).toBe('SAMPLE_LAB_CREDENTIAL_PUBLISH');
    expect(c.templates[0]?.credential_template_version_id).toBe(TEMPLATE_VERSION);
  });

  it('refuses PRODUCTION and every non-lab environment', () => {
    for (const env of ['PRODUCTION', 'UAT', 'SANDBOX', 'STAGING', '']) {
      expect(() => parseIssuanceFixture(RAW, TENANT, env, 'run-1')).toThrow(/refused/);
    }
  });

  it('refuses a fixture that is not SIMULATED, an unknown tenant or malformed refs', () => {
    expect(() =>
      parseIssuanceFixture({ ...RAW, simulation: 'REAL' }, TENANT, 'CI', 'run-1'),
    ).toThrow(/simulation/);
    expect(() =>
      parseIssuanceFixture(RAW, '22222222-2222-4222-8222-222222222222', 'CI', 'run-1'),
    ).toThrow(/tenants/);
    expect(() => parseIssuanceFixture(RAW, TENANT, 'CI', 'bad run id!')).toThrow(/test_run_id/);
    const tenants = structuredClone(RAW['tenants']) as {
      digilocker_publish: Record<string, unknown>;
    }[];
    for (const t of tenants) t.digilocker_publish['consent_ref'] = 'not-a-uuid';
    expect(() => parseIssuanceFixture({ ...RAW, tenants }, TENANT, 'CI', 'run-1')).toThrow(
      /consent_ref/,
    );
  });

  it('the workload context is a SYSTEM workload identity in the fixture tenant', () => {
    const w = workloadContext(cfg(), 'lab-cell-1');
    expect(w.actor.type).toBe('SYSTEM');
    expect(w.auth_assurance).toBe('WORKLOAD_IDENTITY');
    expect(w.tenant_id).toBe(TENANT);
  });
});

describe('SIMULATED connector stand-ins', () => {
  it('the DigiLocker binding is SIMULATED, critical, secret-free and tenant-scoped', async () => {
    const b = new LabDigiLockerBinding(cfg());
    const view = await b.resolveDefault(TENANT);
    expect(view).toMatchObject({ mode: 'SIMULATED', critical: true, secret_ref: null });
    expect(await b.resolveDefault('22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(await b.resolve(TENANT, '0d15ba00-0000-4000-8000-000000000000')).toBeNull();
  });

  it('eSign carries an INT-013 simulation marker for the configured lab environment', async () => {
    const r = await new SimulatedEsignBridge(cfg()).sign(ctx('OFFICER', OFFICER), {
      credential_id: CRED_ID,
      attempt_number: 1,
      idempotency_key: 'k1',
    });
    expect(r.connector_mode).toBe('SIMULATED');
    expect(r.simulation_marker).toMatchObject({ simulation: true, environment: 'LOCAL' });
  });

  it('registry registration goes through CMP-024 transport with the caller idempotency key', async () => {
    const api = apiDouble(() => ({
      status: 201,
      body: { credential_status: { credential_id: CRED_ID, current_status: 'ACTIVE' } },
    }));
    const w = workloadContext(cfg(), 'lab-cell-1');
    const out = await new RegistryBridge(api.factory, cfg()).register(w, {
      credential_id: CRED_ID,
      idempotency_key: 'reg-1',
    });
    expect(out.current_status).toBe('ACTIVE');
    expect(api.calls).toEqual([
      { method: 'POST', path: '/v1/credential-registry/credentials', key: 'reg-1', ctx: w },
    ]);
    const refused = apiDouble(() => ({ status: 403, body: { error_code: 'SF-AUTH-002' } }));
    await expect(
      new RegistryBridge(refused.factory, cfg()).register(w, {
        credential_id: CRED_ID,
        idempotency_key: 'reg-2',
      }),
    ).rejects.toThrow(/SF-AUTH-002/);
  });
});

describe('case issuance pins (approval must be a HUMAN officer transition)', () => {
  it('references the OFFICER RECORD_APPROVED transition once the case is past approval', async () => {
    const c = caseDouble('APPROVED');
    const pins = await new CaseIssuancePinsBridge(c.cases, cfg().templates).getIssuancePins(
      {},
      APP_ID,
    );
    expect(pins?.approval_decision_ref).toBe(
      `cmp015.transition:${c.transitions[0]?.transition_id}`,
    );
    expect(pins?.service_version_id).toBe(cfg().templates[0]?.service_version_id);
  });

  it('gives no approval reference before approval or for a non-officer approval', async () => {
    const early = caseDouble('DECISION_PENDING');
    const bridge = new CaseIssuancePinsBridge(early.cases, cfg().templates);
    expect((await bridge.getIssuancePins({}, APP_ID))?.approval_decision_ref).toBeNull();
    const system = caseDouble('APPROVED');
    for (const t of system.transitions) t.actor_type = 'SYSTEM';
    const bridge2 = new CaseIssuancePinsBridge(system.cases, cfg().templates);
    expect((await bridge2.getIssuancePins({}, APP_ID))?.approval_decision_ref).toBeNull();
  });
});

describe('LabIssuanceCoordinator', () => {
  it('runs ENTER_SIGNING_PENDING → issue → RECORD_ISSUED → publish → outcome as SYSTEM', async () => {
    const l = lab('APPROVED');
    const out = await l.coordinator.issue(ctx('OFFICER', OFFICER), APP_ID);
    expect(out.issuance_error).toBeUndefined();
    expect(out).toMatchObject({
      case_state: 'ISSUED',
      credential: { credential_id: CRED_ID, lifecycle_status: 'ISSUED' },
      digilocker: {
        mode: 'SIMULATED',
        status: 'PUBLISHED',
        provider_transaction_ref: 'sim-dl-0001',
      },
      simulation: true,
      g6_issued: false,
    });
    expect(l.commands).toEqual(['ENTER_SIGNING_PENDING', 'RECORD_ISSUED']);
    const writes = [...l.credential.calls, ...l.digilocker.calls].filter(
      (c) => c.method === 'POST',
    );
    const outcomeKey = 'sample-lab.outcome.0d15ba00-0c12-4000-8000-0d15ba000c99';
    expect(writes.map((c) => [c.path, c.key])).toEqual([
      ['/v1/credentials', `sample-lab.issuance.${APP_ID}.credential`],
      [`/v1/credentials/${CRED_ID}/downstream-outcomes`, outcomeKey],
      ['/v1/digilocker-publish', `sample-lab.publish.${CRED_ID}.1`],
    ]);
    for (const c of [...l.credential.calls, ...l.digilocker.calls]) {
      expect(c.ctx.actor.type).toBe('SYSTEM');
    }
  });

  it('a repeated call resumes without new commands, credentials or publishes', async () => {
    const l = lab('APPROVED');
    await l.coordinator.issue(ctx('OFFICER', OFFICER), APP_ID);
    const before = [...l.credential.calls, ...l.digilocker.calls].filter(
      (c) => c.method === 'POST',
    ).length;
    const again = await l.coordinator.issue(ctx('OFFICER', OFFICER), APP_ID);
    expect(again.digilocker.status).toBe('PUBLISHED');
    expect(l.commands).toEqual(['ENTER_SIGNING_PENDING', 'RECORD_ISSUED']);
    expect(
      [...l.credential.calls, ...l.digilocker.calls].filter((c) => c.method === 'POST').length,
    ).toBe(before);
  });

  it('a publish failure keeps the issued credential and ISSUED case and is reported', async () => {
    const l = lab('APPROVED', 'HTTP_FAIL');
    const out = await l.coordinator.issue(ctx('OFFICER', OFFICER), APP_ID);
    expect(out.case_state).toBe('ISSUED');
    expect(out.credential?.credential_id).toBe(CRED_ID);
    expect(out.issuance_error).toEqual({ error_code: 'SF-INT-001', step: 'DIGILOCKER_PUBLISH' });
    expect(l.credential.calls.some((c) => c.path.endsWith('/downstream-outcomes'))).toBe(false);
  });

  it('only an officer may run issuance, and only after approval', async () => {
    await expect(
      lab('APPROVED').coordinator.issue(ctx('CITIZEN', CITIZEN), APP_ID),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    const early = lab('DECISION_PENDING');
    await expect(early.coordinator.issue(ctx('OFFICER', OFFICER), APP_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SF-APP-001',
    });
    expect(early.commands).toEqual([]);
  });

  it('status projects NOT_REQUESTED before approval without reading CMP-022/012', async () => {
    const l = lab('SUBMITTED');
    const s = await l.coordinator.status(ctx('CITIZEN', CITIZEN), APP_ID);
    expect(s).toMatchObject({ credential: null, digilocker: { status: 'NOT_REQUESTED' } });
    expect(l.credential.calls).toEqual([]);
    expect(l.digilocker.calls).toEqual([]);
  });
});

describe('issuance routes', () => {
  it('refuse to register outside LOCAL/CI', async () => {
    const app = Fastify();
    await expect(
      registerLabIssuanceRoutes(app, {
        environment: 'PRODUCTION',
        coordinator: lab('APPROVED').coordinator,
        resolveContext: async () => null,
      }),
    ).rejects.toThrow(/refused/);
    await app.close();
  });

  it('require a context, a UUID id and an empty POST body', async () => {
    const app = Fastify();
    let principal: RequestContext | null = null;
    await registerLabIssuanceRoutes(app, {
      environment: 'CI',
      coordinator: lab('APPROVED').coordinator,
      resolveContext: async () => principal,
    });
    expect((await app.inject({ url: `/v1/applications/${APP_ID}/issuance` })).statusCode).toBe(401);
    principal = ctx('OFFICER', OFFICER);
    expect((await app.inject({ url: '/v1/applications/not-a-uuid/issuance' })).statusCode).toBe(
      400,
    );
    const injected = await app.inject({
      method: 'POST',
      url: `/v1/applications/${APP_ID}/issuance`,
      payload: { tenant_id: TENANT, actor: 'SYSTEM' },
    });
    expect(injected.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/applications/${APP_ID}/issuance`,
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.json()).toMatchObject({ digilocker: { status: 'PUBLISHED' }, g6_issued: false });
    await app.close();
  });
});
