import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAssistedApi } from '../../src/api/handler.js';
import { buildAssistedSessionService } from '../../src/index.js';
import { PgAssistedRepository } from '../../src/repo/pg.js';
import type { TenantContext } from '../../src/types.js';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  ACTOR_VERIFIER,
  APPLICATION_1,
  ASSURANCE_REF,
  AUTHORITY_REF,
  CONSENT_REF,
  ctxFor,
  ScriptedAuthorizer,
  ScriptedVerification,
  startBody,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { asSqlPool, closeHarness, resetData, setupHarness, type Harness } from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-057 API flow on PostgreSQL (INT-015)', () => {
  let h: Harness;
  let authorizer: ScriptedAuthorizer;
  let verification: ScriptedVerification;
  let state: { ctx: TenantContext | null };
  let call: (
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) => Promise<{ status: number; body: unknown }>;

  beforeAll(async () => {
    h = await setupHarness();
  }, 180_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  beforeEach(async () => {
    await resetData(h.admin);
    authorizer = new ScriptedAuthorizer();
    verification = new ScriptedVerification();
    state = { ctx: ctxFor(TENANT_A) };
    const service = buildAssistedSessionService({
      repository: new PgAssistedRepository(asSqlPool(h.rt)),
      authorizer,
      verification,
      clock: () => new Date('2026-10-15T12:00:00Z'),
    });
    const api = createAssistedApi({
      service,
      resolveContext: () => Promise.resolve(state.ctx),
    });
    let n = 0;
    call = async (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> = {};
      if (method === 'POST') {
        headers['idempotency-key'] = key ?? `pg-key-${String(n).padStart(6, '0')}`;
      }
      return api.handle({ method, path, headers, body });
    };
  });

  it('runs counter start → bind → verify → submit with tenant isolation', async () => {
    const start = await call('POST', '/v1/assisted/sessions', startBody());
    expect(start.status).toBe(201);
    const id = (start.body as Body)['assisted_session']['session_id'] as string;
    let version = (start.body as Body)['session_version'] as number;

    const bound = await call('POST', `/v1/assisted/sessions/${id}/applicant`, {
      expected_version: version,
      applicant_assurance_ref: ASSURANCE_REF,
    });
    expect(bound.status).toBe(200);
    version = (bound.body as Body)['session_version'] as number;

    const verified = await call('POST', `/v1/assisted/sessions/${id}/representation`, {
      expected_version: version,
      representation_authority_ref: null,
      consent_ref: CONSENT_REF,
      read_back_acknowledged: true,
    });
    expect(verified.status).toBe(200);
    version = (verified.body as Body)['session_version'] as number;

    const submitted = await call('POST', `/v1/assisted/sessions/${id}/submit`, {
      expected_version: version,
      application_id: APPLICATION_1,
    });
    expect(submitted.status).toBe(200);
    expect((submitted.body as Body)['assisted_session']['lifecycle_status']).toBe('SUBMITTED');
    expect(
      (submitted.body as Body)['assisted_session']['applied_by_distinct_from_applied_for'],
    ).toBe(true);

    state.ctx = ctxFor(TENANT_B, ACTOR_OFFICER, 'OFFICER');
    const cross = await call('GET', `/v1/assisted/sessions/${id}`);
    expect(cross.status).toBe(404);
  });

  it('representation channel refuses self-verification and accepts third-party opaque ref', async () => {
    const start = await call(
      'POST',
      '/v1/assisted/sessions',
      startBody({ channel: 'AUTHORIZED_REPRESENTATIVE' }),
    );
    expect(start.status).toBe(201);
    const id = (start.body as Body)['assisted_session']['session_id'] as string;
    let version = (start.body as Body)['session_version'] as number;
    const bound = await call('POST', `/v1/assisted/sessions/${id}/applicant`, {
      expected_version: version,
      applicant_assurance_ref: ASSURANCE_REF,
    });
    version = (bound.body as Body)['session_version'] as number;

    const self = await call('POST', `/v1/assisted/sessions/${id}/representation`, {
      expected_version: version,
      representation_authority_ref: AUTHORITY_REF,
      consent_ref: CONSENT_REF,
      read_back_acknowledged: true,
    });
    expect(self.status).toBe(403);

    state.ctx = ctxFor(TENANT_A, ACTOR_VERIFIER, 'OFFICER');
    const ok = await call('POST', `/v1/assisted/sessions/${id}/representation`, {
      expected_version: version,
      representation_authority_ref: AUTHORITY_REF,
      consent_ref: CONSENT_REF,
      read_back_acknowledged: true,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as Body)['assisted_session']['representation_authority_ref']).toBe(
      AUTHORITY_REF,
    );
  });

  it('citizen resume preserves application identity after handoff', async () => {
    const start = await call('POST', '/v1/assisted/sessions', startBody());
    const id = (start.body as Body)['assisted_session']['session_id'] as string;
    let version = (start.body as Body)['session_version'] as number;
    version = (
      (
        await call('POST', `/v1/assisted/sessions/${id}/applicant`, {
          expected_version: version,
          applicant_assurance_ref: ASSURANCE_REF,
        })
      ).body as Body
    )['session_version'] as number;
    version = (
      (
        await call('POST', `/v1/assisted/sessions/${id}/representation`, {
          expected_version: version,
          representation_authority_ref: null,
          consent_ref: CONSENT_REF,
          read_back_acknowledged: true,
        })
      ).body as Body
    )['session_version'] as number;
    const hand = await call('POST', `/v1/assisted/sessions/${id}/handoff`, {
      expected_version: version,
      application_id: APPLICATION_1,
    });
    expect(hand.status).toBe(200);
    const token = (hand.body as Body)['handoff']['handoff_token'] as string;

    state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const resume = await call('POST', `/v1/assisted/sessions/${id}/resume`, {
      handoff_token: token,
    });
    expect(resume.status).toBe(200);
    expect((resume.body as Body)['resume']['application_id']).toBe(APPLICATION_1);
    expect((resume.body as Body)['resume']['applied_for_citizen_id']).toBe(ACTOR_CITIZEN);
    expect((resume.body as Body)['assisted_session']['lifecycle_status']).toBe('CLOSED');
  });

  it('refuses self-assisted start at the API boundary', async () => {
    const res = await call(
      'POST',
      '/v1/assisted/sessions',
      startBody({ applied_for_citizen_id: ACTOR_OFFICER }),
    );
    expect(res.status).toBe(403);
    expect((res.body as Body)['details'][0]['code']).toBe('APPLIED_BY_EQUALS_APPLIED_FOR');
  });
});
