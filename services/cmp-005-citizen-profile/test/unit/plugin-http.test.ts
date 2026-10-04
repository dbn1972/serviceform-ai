import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { randomUUID } from 'node:crypto';
import { registerCitizenProfile } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { frozenClock } from '../doubles/clock.js';
import { AllowConsent, AlwaysSubject, RecordingLocker } from '../doubles/ports.js';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  BINDING,
  T1,
  T2,
  TRACE,
  createMemoryPool,
  emptyStore,
  type MemoryStore,
} from './memory-pool.js';

function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: partial.actor.type === 'CITIZEN' ? ['CITIZEN'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...partial,
  };
}

function key(label: string): string {
  return `idem-${label}-${randomUUID().slice(0, 8)}`;
}

describe('plugin HTTP + memory repository', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let consent: AllowConsent;
  let authorizer: ContractAuthorizer;
  let locker: RecordingLocker;

  beforeAll(async () => {
    fixtures.clear();
    fixtures.set('officer', ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }));
    fixtures.set('citizen', ctx({ tenant_id: T1, actor: { type: 'CITIZEN', id: ACTOR_CITIZEN } }));
    fixtures.set(
      'officer-t2',
      ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: ACTOR_OFFICER } }),
    );
    store = emptyStore();
    consent = new AllowConsent();
    authorizer = new ContractAuthorizer();
    locker = new RecordingLocker();
    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    await registerCitizenProfile(app, {
      prefix: '/v1',
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      authorizer,
      consentAccess: consent,
      subjectDirectory: new AlwaysSubject(),
      digiLocker: locker,
      clock: frozenClock('2026-10-04T12:00:00.000Z'),
      deploymentEnvironment: 'CI',
      digiLockerBinding: BINDING,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires auth and rejects tenant-identifying headers', async () => {
    const unauth = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
    });
    expect(unauth.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer officer', 'x-tenant-id': T1 },
    });
    expect(forged.statusCode).toBe(403);
    const bad = await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${ACTOR_CITIZEN}/claims`,
      headers: { authorization: 'Bearer officer', 'idempotency-key': key('bad') },
      payload: { purpose_code: 'X', claims: [] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('ensures profile, upserts self-asserted claims, and omits PII from events', async () => {
    const ensure = await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${ACTOR_CITIZEN}`,
      headers: { authorization: 'Bearer officer', 'idempotency-key': key('ens') },
      payload: {},
    });
    expect(ensure.statusCode).toBe(200);
    const upsert = await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${ACTOR_CITIZEN}/claims`,
      headers: { authorization: 'Bearer officer', 'idempotency-key': key('up') },
      payload: {
        purpose_code: 'PROFILE_ACCESS',
        claims: [
          { section_code: 'IDENTITY', claim_code: 'DISPLAY_NAME', value_text: 'SECRET_NAME' },
        ],
      },
    });
    expect(upsert.statusCode).toBe(200);
    const dumped = JSON.stringify(store.outbox);
    expect(dumped).not.toContain('SECRET_NAME');
    expect(dumped).toContain('ProfileClaimUpserted');
    const got = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer officer' },
    });
    expect(got.statusCode).toBe(200);
    expect(got.headers['cache-control']).toContain('private');
    const body = got.json() as { claims: { value_text?: string; value_sha256: string }[] };
    expect(body.claims[0]?.value_text).toBe('SECRET_NAME');
    expect(body.claims[0]?.value_sha256.startsWith('sha256:')).toBe(true);
  });

  it('denies claim values when consent port fails closed', async () => {
    consent.allowed = false;
    consent.reason_code = 'MISSING_CONSENT';
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer officer' },
    });
    expect(denied.statusCode).toBe(403);
    expect(JSON.stringify(denied.json())).not.toContain('SECRET_NAME');
    consent.throws = true;
    const down = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer officer' },
    });
    expect(down.statusCode).toBe(503);
    consent.throws = false;
    consent.allowed = true;
    consent.reason_code = 'OK';
  });

  it('imports SIMULATED DigiLocker claims outside a transaction', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/profiles/${ACTOR_CITIZEN}/verified-claims/import`,
      headers: { authorization: 'Bearer officer', 'idempotency-key': key('imp') },
      payload: {
        purpose_code: 'PROFILE_ACCESS',
        scenario: 'happy',
        test_run_id: 'run-1',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(locker.calledInTx).toBe(false);
    const body = res.json() as { simulation: { simulation: boolean } };
    expect(body.simulation.simulation).toBe(true);
    expect(JSON.stringify(res.json())).not.toMatch(/aadhaar/i);
  });

  it('citizens cannot read another subject; unknown claim codes are refused', async () => {
    const other = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_OFFICER}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer citizen' },
    });
    expect(other.statusCode).toBe(403);
    const unknown = await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${ACTOR_CITIZEN}/claims`,
      headers: { authorization: 'Bearer officer', 'idempotency-key': key('unk') },
      payload: {
        purpose_code: 'PROFILE_ACCESS',
        claims: [{ section_code: 'IDENTITY', claim_code: 'CASTE', value_text: 'no' }],
      },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('PDP deny is 403 and wrong-tenant header is 403', async () => {
    authorizer.denies.add('PROFILE_READ');
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer officer' },
    });
    expect(denied.statusCode).toBe(403);
    authorizer.denies.clear();
    const header = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
      headers: { authorization: 'Bearer officer', 'x-sf-tenant': T2 },
    });
    expect(header.statusCode).toBe(403);
  });
});

describe('production fail-closed', () => {
  it('refuses SIMULATED DigiLocker binding in PRODUCTION', async () => {
    const app = Fastify({ logger: false });
    await expect(
      registerCitizenProfile(app, {
        pool: createMemoryPool(emptyStore()),
        resolveContext: fixtureResolver,
        authorizer: new ContractAuthorizer(),
        consentAccess: new AllowConsent(),
        subjectDirectory: new AlwaysSubject(),
        deploymentEnvironment: 'PRODUCTION',
        digiLockerBinding: { ...BINDING, mode: 'SIMULATED', environment: 'PRODUCTION' },
      }),
    ).rejects.toMatchObject({ details: [{ code: 'PRODUCTION_SIMULATED_REFUSED' }] });
    await app.close();
  });
});
