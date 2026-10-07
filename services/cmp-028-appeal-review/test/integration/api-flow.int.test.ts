import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAppealHandler,
  type HttpRequest,
  type HttpResponse,
} from '../../src/http/handler.js';
import { PgAppealRepository } from '../../src/repo/pg.js';
import { AppealService } from '../../src/service/appeal-service.js';
import type { SqlPool } from '../../src/sql.js';
import { ScriptedAuthorizer } from '../doubles/authorizer.js';
import { ctxFor, fileBody, OFFICER_1, CITIZEN_1, TENANT_B } from '../doubles/fixtures.js';
import { RecordingCasePort, RecordingWorkflowPort } from '../doubles/harness.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
let authz: ScriptedAuthorizer;
let caseCommands: RecordingCasePort;
let call: (token: string, method: string, path: string, body?: unknown) => Promise<HttpResponse>;
let seq = 0;

const tokens = new Map<string, ReturnType<typeof ctxFor>>([
  ['cit-a', ctxFor(CITIZEN_1, { roles: ['CITIZEN'] }, 'CITIZEN')],
  ['off1-a', ctxFor(OFFICER_1)],
  ['off1-b', ctxFor(OFFICER_1, { tenant_id: TENANT_B })],
]);

beforeAll(async () => {
  h = await setupHarness();
  authz = new ScriptedAuthorizer();
  caseCommands = new RecordingCasePort();
  const service = new AppealService({
    repo: new PgAppealRepository(h.rt as unknown as SqlPool),
    authz,
    caseCommands,
    workflow: new RecordingWorkflowPort(),
  });
  const handler = createAppealHandler({
    service,
    resolveContext: async (req) => {
      const auth = req.headers['authorization'];
      return tokens.get(typeof auth === 'string' ? auth.replace('Bearer ', '') : '') ?? null;
    },
  });
  call = (token, method, path, body) => {
    seq += 1;
    const req: HttpRequest = {
      method,
      path,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `int-key-${String(seq).padStart(8, '0')}`,
      },
      body,
    };
    return handler(req);
  };
});
afterAll(async () => closeHarness(h));
beforeEach(() => {
  authz.denyActions.clear();
  authz.throws = false;
  authz.policyRevision = 'rev-int-1';
});

describe('CMP-028 API on PostgreSQL', () => {
  it('files an appeal, records admissibility, and never leaks across tenants', async () => {
    const created = await call('cit-a', 'POST', '/v1/appeals', fileBody());
    expect(created.status).toBe(201);
    const id = (created.body as { appeal_id: string }).appeal_id;
    const admitted = await call('off1-a', 'POST', `/v1/appeals/${id}/admissibility`, {
      admissibility_code: 'ADMITTED',
      reason_code: 'WITHIN_LIMITATION',
    });
    expect(admitted.status).toBe(200);
    expect((admitted.body as { appeal_state: string }).appeal_state).toBe('ADMITTED');
    const other = await call('off1-b', 'GET', `/v1/appeals/${id}`);
    expect(other.status).toBe(404);
    authz.denyActions.add('APPEAL_RECORD_DECISION');
    const denied = await call('off1-a', 'POST', `/v1/appeals/${id}/decision`, {
      decision_ref: '00000000-0000-4000-8000-000000000082',
    });
    expect(denied.status).toBe(403);
  });
});
