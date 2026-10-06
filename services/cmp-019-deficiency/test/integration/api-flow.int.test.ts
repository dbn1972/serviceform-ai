import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeficiencyApi } from '../../src/api/handler.js';
import { buildDeficiencyService } from '../../src/index.js';
import { PgDeficiencyRepository } from '../../src/repo/pg.js';
import type { RequestContext } from '../../src/types.js';
import {
  ACTOR_CITIZEN,
  AllowAllAuthorizer,
  ctxFor,
  MutableClock,
  OPEN_BODY,
  RecordingCaseCommands,
  RecordingNotifier,
  RecordingSlaClock,
  RESPOND_BODY,
} from '../doubles/fixtures.js';
import { asSqlPool, closeHarness, setupHarness, T1, T2, type Harness } from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-019 end to end on PostgreSQL (real login role, FORCE RLS)', () => {
  let h: Harness;
  const clock = new MutableClock(Date.parse('2026-10-06T10:00:00Z'));
  const notifier = new RecordingNotifier();
  const slaClock = new RecordingSlaClock();
  const caseCommands = new RecordingCaseCommands();
  const state: { ctx: RequestContext } = { ctx: ctxFor(T1) };
  let call: (
    method: string,
    path: string,
    body?: unknown,
    key?: string | null,
  ) => Promise<{ status: number; body: unknown }>;
  let n = 0;

  beforeAll(async () => {
    h = await setupHarness();
    const service = buildDeficiencyService({
      repository: new PgDeficiencyRepository(asSqlPool(h.rt)),
      authorizer: new AllowAllAuthorizer(),
      notifier,
      slaClock,
      caseCommands,
      clock: clock.now,
    });
    const api = createDeficiencyApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
    call = async (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> =
        key === null ? {} : { 'idempotency-key': key ?? `int-key-${String(n).padStart(6, '0')}` };
      return api.handle({ method, path, headers, body });
    };
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('opens, pauses INT-009, records a citizen response, resumes, and isolates tenants', async () => {
    const opened = await call('POST', '/v1/deficiencies', OPEN_BODY);
    expect(opened.status).toBe(201);
    const id = (opened.body as Body).deficiency_id as string;
    expect(slaClock.pauses).toHaveLength(1);
    expect(caseCommands.commands[0]?.body.command).toBe('RAISE_DEFICIENCY');

    state.ctx = ctxFor(T1, ACTOR_CITIZEN, 'CITIZEN');
    const responded = await call('POST', `/v1/deficiencies/${id}/response`, RESPOND_BODY);
    expect(responded.status).toBe(200);
    expect(slaClock.resumes).toHaveLength(1);

    state.ctx = ctxFor(T2);
    const leak = await call('GET', `/v1/deficiencies/${id}`);
    expect(leak.status).toBe(404);

    state.ctx = ctxFor(T1);
    const got = await call('GET', `/v1/deficiencies/${id}`);
    expect((got.body as Body).status).toBe('RESPONSE_RECEIVED');
  });
});
