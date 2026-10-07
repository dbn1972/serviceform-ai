import { createDeficiencyApi, type ApiResponse } from '../../src/api/handler.js';
import { buildDeficiencyService } from '../../src/index.js';
import type { RequestContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  MutableClock,
  RecordingCaseCommands,
  RecordingNotifier,
  RecordingSlaClock,
  TENANT_A,
} from './fixtures.js';
import { MemoryDeficiencyRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
}

export function makeHarness(startIso = '2026-10-06T10:00:00Z') {
  const repo = new MemoryDeficiencyRepository();
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new AllowAllAuthorizer();
  const notifier = new RecordingNotifier();
  const slaClock = new RecordingSlaClock();
  const caseCommands = new RecordingCaseCommands();
  const state: { ctx: RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildDeficiencyService({
    repository: repo,
    authorizer,
    notifier,
    slaClock,
    caseCommands,
    clock: clock.now,
  });
  const api = createDeficiencyApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
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
    return api.handle({ method, path, headers, body });
  }

  return { repo, clock, authorizer, notifier, slaClock, caseCommands, state, service, api, call };
}

export type Harness = ReturnType<typeof makeHarness>;
