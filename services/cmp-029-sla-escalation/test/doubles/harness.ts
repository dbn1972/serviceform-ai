import { createSlaApi, type ApiResponse } from '../../src/api/handler.js';
import { buildSlaService } from '../../src/index.js';
import type { RequestContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  APPLICATION_ID,
  CALENDAR_BODY,
  ctxFor,
  MutableClock,
  policyBody,
  RecordingNotifier,
  TENANT_A,
} from './fixtures.js';
import { MemorySlaRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(startIso = '2026-10-05T10:00:00Z') {
  const repo = new MemorySlaRepository();
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new AllowAllAuthorizer();
  const notifier = new RecordingNotifier();
  const state: { ctx: RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const deps = { repository: repo, authorizer, notifier, clock: clock.now };
  const service = buildSlaService(deps);
  const api = createSlaApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.key !== null)
      headers['idempotency-key'] = opts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    return api.handle({
      method,
      path,
      headers,
      ...(opts.query ? { query: opts.query } : {}),
      body,
    });
  }

  async function seed(
    policyOverrides: Record<string, unknown> = {},
  ): Promise<{ calendarId: string; policyId: string }> {
    const cal = await call('POST', '/v1/sla-calendars', CALENDAR_BODY);
    const calendarId = (cal.body as { calendar_version_id: string }).calendar_version_id;
    const pol = await call('POST', '/v1/sla-policies', policyBody(calendarId, policyOverrides));
    const policyId = (pol.body as { sla_policy_version_id: string }).sla_policy_version_id;
    return { calendarId, policyId };
  }

  async function startClock(policyId: string, applicationId = APPLICATION_ID): Promise<string> {
    const res = await call('POST', '/v1/sla-clocks', {
      application_id: applicationId,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    return (res.body as { sla_clock: { clock_id: string } }).sla_clock.clock_id;
  }

  return { repo, clock, authorizer, notifier, state, service, api, call, seed, startClock };
}

export type Harness = ReturnType<typeof makeHarness>;
