import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { placementContextResolver } from '../src/platform/context.js';
import { parsePlacement, type PortalPlacement } from '../src/platform/placement.js';
import { buildPlatformLab, publishedFormFor } from '../src/platform/runtime.js';
import {
  assertSimulatorEnvironment,
  registerLabSimulators,
  SimulatedOtpInbox,
} from '../src/platform/simulators.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const LAB = join(ROOT, 'fixtures/lab/platform');
const placementFile = JSON.parse(
  readFileSync(join(LAB, 'placement.citizen.json'), 'utf8'),
) as PortalPlacement;
const TENANT = placementFile.tenant_id;
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const CITIZEN = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const OFFICER = '0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f';

describe('portal placement (SF-CON-PORTAL-PLACEMENT, ADR-0007 D-1/D-4)', () => {
  it('accepts the SAMPLE_LAB placement in its own environment', () => {
    expect(parsePlacement(placementFile, 'LOCAL').tenant_id).toBe(TENANT);
  });

  it('refuses production, environment mismatch and invalid placements', () => {
    expect(() => parsePlacement(placementFile, 'PRODUCTION')).toThrow(/ADR-0007 D-4/);
    expect(() => parsePlacement(placementFile, 'PREPROD')).toThrow(/ADR-0007 D-4/);
    expect(() => parsePlacement(placementFile, 'CI')).toThrow(/does not match/);
    expect(() =>
      parsePlacement({ ...placementFile, client_tenant_input_accepted: true }, 'LOCAL'),
    ).toThrow(/SF-CON-PORTAL-PLACEMENT/);
    expect(() => parsePlacement({ ...placementFile, offerings: [] }, 'LOCAL')).toThrow();
  });
});

describe('placement context resolver (ADR-0007 D-1)', () => {
  const request = (id = '9b2f5c0e-4f6a-4c1e-9d3b-2a1b3c4d5e6f') => ({ id }) as never;
  const verifier = (actor_type: string | null, subject_id = CITIZEN) => ({
    verify: async () => (actor_type ? { subject_id, actor_type, assurance: 'OTP' as const } : null),
  });
  const sessions = (tenant: string | null, type: 'CITIZEN' | 'OFFICER', roles: string[] = []) => ({
    resolve: async (p: { subject_id: string }) => ({
      tenant_id: tenant,
      cell_id: 'cell-01',
      actor: { type, id: p.subject_id },
      roles,
      jurisdiction_ids: [],
      auth_assurance: 'OTP' as const,
    }),
  });

  it('gives a citizen the placement tenant and no roles', async () => {
    const resolve = placementContextResolver({
      verifier: verifier('CITIZEN'),
      sessions: sessions(null, 'CITIZEN', ['FORGED_ROLE']),
      placement: placementFile,
    });
    const ctx = await resolve(request());
    expect(ctx).toMatchObject({
      tenant_id: TENANT,
      cell_id: placementFile.cell_id,
      actor: { type: 'CITIZEN', id: CITIZEN },
      roles: [],
      correlation_id: '9b2f5c0e-4f6a-4c1e-9d3b-2a1b3c4d5e6f',
      trace_id: '9b2f5c0e4f6a4c1e9d3b2a1b3c4d5e6f',
    });
  });

  it('keeps an officer session tenant only when it is the placement tenant', async () => {
    const same = placementContextResolver({
      verifier: verifier('OFFICER', OFFICER),
      sessions: sessions(TENANT, 'OFFICER', ['SAMPLE_LAB_CASE_OFFICER']),
      placement: placementFile,
    });
    expect((await same(request()))?.roles).toEqual(['SAMPLE_LAB_CASE_OFFICER']);
    const other = placementContextResolver({
      verifier: verifier('OFFICER', OFFICER),
      sessions: sessions(OTHER_TENANT, 'OFFICER', ['SAMPLE_LAB_CASE_OFFICER']),
      placement: placementFile,
    });
    expect(await other(request())).toBeNull();
  });

  it('returns null without a verified principal, on actor mismatch, or unresolved session', async () => {
    const none = placementContextResolver({
      verifier: verifier(null),
      sessions: sessions(null, 'CITIZEN'),
      placement: placementFile,
    });
    expect(await none(request())).toBeNull();
    const mismatch = placementContextResolver({
      verifier: verifier('CITIZEN'),
      sessions: sessions(TENANT, 'OFFICER'),
      placement: placementFile,
    });
    expect(await mismatch(request())).toBeNull();
    const gone = placementContextResolver({
      verifier: verifier('CITIZEN'),
      sessions: { resolve: async () => null },
      placement: placementFile,
    });
    expect(await gone(request())).toBeNull();
    const ctx = await placementContextResolver({
      verifier: verifier('CITIZEN'),
      sessions: sessions(null, 'CITIZEN'),
      placement: placementFile,
    })(request('not-a-uuid'));
    expect(ctx?.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('SAMPLE_LAB simulators (INT-013: LOCAL/CI only)', () => {
  it('refuses environments other than LOCAL/CI', () => {
    for (const env of ['SIT', 'UAT', 'PREPROD', 'PRODUCTION']) {
      expect(() => assertSimulatorEnvironment(env)).toThrow(/refused/);
    }
    expect(() => assertSimulatorEnvironment('CI')).not.toThrow();
  });

  it('OTP inbox records through the wrapped adapter and expires', async () => {
    let now = 1_000;
    const inbox = new SimulatedOtpInbox(() => now);
    const dispatched: string[] = [];
    const adapter = inbox.wrap({
      createChallenge: () => ({ code: '123456', simulation: { simulation: true } }),
      dispatch: async (i) => {
        dispatched.push(i.challengeId);
      },
    });
    adapter.createChallenge({ challengeId: 'c1', channelHash: 'h', testRunId: 't' });
    await adapter.dispatch({ challengeId: 'c1', channelHash: 'h' });
    expect(inbox.read('c1')).toBe('123456');
    expect(dispatched).toEqual(['c1']);
    now += 5 * 60 * 1000;
    expect(inbox.read('c1')).toBeNull();
    inbox.record('c2', '654321');
    expect(inbox.read('c2')).toBe('654321');
  });

  it('serves the inbox by challenge id and mints assertions only for directory officers', async () => {
    const inbox = new SimulatedOtpInbox();
    const challenge = '0d15ba00-aaaa-4000-8000-0d15ba00aaaa';
    inbox.record(challenge, '246810');
    const minted: unknown[] = [];
    const app = Fastify();
    await registerLabSimulators(app, {
      environment: 'LOCAL',
      inbox,
      officers: [
        {
          officer_id: OFFICER,
          subject: 'lab-officer',
          display_name: 'SAMPLE LAB Officer',
          tenant_id: TENANT,
          roles: ['SAMPLE_LAB_CASE_OFFICER'],
        },
      ],
      mint: (claims) => {
        minted.push(claims);
        return 'simidp.x.y';
      },
      clock: () => 10_000,
    });
    const code = await app.inject({ url: `/v1/simulated/otp-inbox/${challenge}` });
    expect(code.json()).toMatchObject({ code: '246810', simulation: true });
    expect(code.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/v1/simulated/otp-inbox/not-a-uuid' })).statusCode).toBe(404);
    const unknown = '0d15ba00-bbbb-4000-8000-0d15ba00bbbb';
    expect((await app.inject({ url: `/v1/simulated/otp-inbox/${unknown}` })).statusCode).toBe(404);
    const list = await app.inject({ url: '/v1/simulated/idp/officers' });
    expect(JSON.stringify(list.json())).not.toContain(OFFICER);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/simulated/idp/assertions',
      payload: { subject: 'lab-officer' },
    });
    expect(ok.json()).toMatchObject({ assertion: 'simidp.x.y', simulation: true });
    expect(minted[0]).toMatchObject({ officer_id: OFFICER, tenant_id: TENANT, exp: 130 });
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/simulated/idp/assertions',
      payload: { subject: 'someone-else' },
    });
    expect(denied.statusCode).toBe(401);
    await expect(
      registerLabSimulators(Fastify(), {
        environment: 'UAT',
        inbox,
        officers: [],
        mint: () => '',
      }),
    ).rejects.toThrow(/refused/);
  });
});

describe('buildPlatformLab composition', () => {
  const env = {
    SF_ENVIRONMENT: 'LOCAL',
    SF_PLATFORM_LAB_DIR: LAB,
    DATABASE_URL_CMP004: 'postgres://u:p@127.0.0.1:1/none',
    DATABASE_URL_CMP015: 'postgres://u:p@127.0.0.1:1/none',
    DATABASE_URL_CMP009: 'postgres://u:p@127.0.0.1:1/none',
    DATABASE_URL_CMP016: 'postgres://u:p@127.0.0.1:1/none',
    SF_TEMPORAL_ADDRESS: '127.0.0.1:1',
    SF_TEMPORAL_TASK_QUEUE: 'sf-sample-lab-workflow',
    SF_CMP004_PEPPER: 'x'.repeat(64),
    SF_OPA_URL: 'http://127.0.0.1:1',
  };

  it('composes CMP-004, CMP-009, CMP-015 and CMP-016 sequencing from the SAMPLE_LAB fixtures', async () => {
    const lab = await buildPlatformLab(env);
    try {
      expect(lab.placement.portal_id).toBe('sample-lab-citizen');
      expect(lab.m02.identityAccess?.cellId).toBe(placementFile.cell_id);
      expect(lab.m05.applicationCase?.service).toBeDefined();
      expect(lab.m04.forms?.forms).toBeDefined();
      expect(lab.readinessChecks.map((c) => c.name)).toEqual([
        'cmp004-db',
        'cmp009-db',
        'cmp015-db',
        'cmp016-db',
        'cmp016-temporal-worker',
      ]);
      // Nothing connects to Temporal at build time; the worker is not ready until start().
      const worker = lab.readinessChecks.find((c) => c.name === 'cmp016-temporal-worker');
      await expect(worker?.check()).rejects.toThrow(/worker not running/);
      const app = Fastify();
      await lab.registerSimulators(app);
      const officers = await app.inject({ url: '/v1/simulated/idp/officers' });
      expect((officers.json() as { officers: unknown[] }).officers).toHaveLength(1);
    } finally {
      await lab.close();
    }
  });

  it('fails closed on missing config, a short pepper or a non-lab environment', async () => {
    await expect(buildPlatformLab({ ...env, SF_ENVIRONMENT: 'UAT' })).rejects.toThrow(/refused/);
    await expect(buildPlatformLab({ ...env, SF_CMP004_PEPPER: 'short' })).rejects.toThrow(
      /SF_CMP004_PEPPER/,
    );
    await expect(buildPlatformLab({ ...env, SF_IDENTITY_RATE_LIMIT_MAX: '0' })).rejects.toThrow(
      /SF_IDENTITY_RATE_LIMIT_MAX/,
    );
    const limited = await buildPlatformLab({ ...env, SF_IDENTITY_RATE_LIMIT_MAX: '500' });
    expect(limited.m02.identityAccess?.rateLimitMax).toBe(500);
    await limited.close();
    const { SF_OPA_URL: _omit, ...noOpa } = env;
    await expect(buildPlatformLab(noOpa)).rejects.toThrow(/SF_OPA_URL/);
    const { DATABASE_URL_CMP009: _db, ...noForms } = env;
    await expect(buildPlatformLab(noForms)).rejects.toThrow(/DATABASE_URL_CMP009/);
    const { DATABASE_URL_CMP016: _wf, ...noWorkflowDb } = env;
    await expect(buildPlatformLab(noWorkflowDb)).rejects.toThrow(/DATABASE_URL_CMP016/);
    const { SF_TEMPORAL_ADDRESS: _t, ...noTemporal } = env;
    await expect(buildPlatformLab(noTemporal)).rejects.toThrow(/SF_TEMPORAL_ADDRESS/);
    await expect(
      buildPlatformLab({ ...env, SF_TEMPORAL_ADDRESS: 'http://127.0.0.1:7233' }),
    ).rejects.toThrow(/SF_TEMPORAL_ADDRESS/);
    const { SF_TEMPORAL_TASK_QUEUE: _q, ...noQueue } = env;
    await expect(buildPlatformLab(noQueue)).rejects.toThrow(/SF_TEMPORAL_TASK_QUEUE/);
    await expect(buildPlatformLab({ ...env, SF_FORMS_RATE_LIMIT_MAX: '0' })).rejects.toThrow(
      /SF_FORMS_RATE_LIMIT_MAX/,
    );
  });
});

describe('SIMULATED form publication from the template catalogue', () => {
  const RESIDENCE_FORM = ['ind-soc-002', 'application'].join('.');
  const bindings = JSON.parse(readFileSync(join(LAB, 'published-bindings.json'), 'utf8')) as {
    bindings: { catalogue_id: string; pins: { form_version_id: string } }[];
  };

  it('publishes the PUBLISHED catalogue version the binding pins', () => {
    const b = bindings.bindings[0];
    expect(b).toBeDefined();
    const form = publishedFormFor(b?.catalogue_id ?? '', b?.pins.form_version_id ?? '', TENANT);
    expect(form).toMatchObject({
      tenant_id: TENANT,
      form_key: RESIDENCE_FORM,
      version_id: b?.pins.form_version_id,
      status: 'PUBLISHED',
    });
    expect(form.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('refuses a pin that is not the PUBLISHED version, or an unknown or stub service', () => {
    expect(() =>
      publishedFormFor('IND-SOC-002', '0d15ba00-0019-4000-8000-0d15ba000019', TENANT),
    ).toThrow(/no PUBLISHED form version/);
    expect(() =>
      publishedFormFor('IND-SOC-031', '7e3a0031-0001-4000-8000-00000000031a', TENANT),
    ).toThrow(/no PUBLISHED form version/);
    expect(() => publishedFormFor('IND-XXX-000', OTHER_TENANT, TENANT)).toThrow();
  });
});
