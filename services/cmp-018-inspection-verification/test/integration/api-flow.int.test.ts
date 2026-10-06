import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInspectionHandler, type HttpResponse } from '../../src/http/handler.js';
import { PgInspectionRepository } from '../../src/repo/pg.js';
import { InspectionService } from '../../src/service/inspection-service.js';
import type { SqlPool } from '../../src/sql.js';
import { contextOnlyScope } from '../../src/ports/principal-scope.js';
import { ScriptedAuthorizer } from '../doubles/authorizer.js';
import { ctxFor, createBody, OFFICER_1, TENANT_B, WORKFLOW_SYSTEM } from '../doubles/fixtures.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
let call: (token: string, method: string, path: string, body?: unknown) => Promise<HttpResponse>;
let seq = 0;

const tokens = new Map([
  [
    'sys-a',
    ctxFor(
      WORKFLOW_SYSTEM,
      {
        roles: ['WORKFLOW_ENGINE'],
        organisation_id: undefined,
        office_id: undefined,
        jurisdiction_ids: [],
      },
      'SYSTEM',
    ),
  ],
  ['off1-a', ctxFor(OFFICER_1)],
  ['off1-b', ctxFor(OFFICER_1, { tenant_id: TENANT_B })],
]);

beforeAll(async () => {
  h = await setupHarness();
  const service = new InspectionService({
    repo: new PgInspectionRepository(h.rt as unknown as SqlPool),
    authz: new ScriptedAuthorizer(),
    scopes: contextOnlyScope,
  });
  const handler = createInspectionHandler({
    service,
    resolveContext: async (req) => {
      const auth = req.headers['authorization'];
      return tokens.get(typeof auth === 'string' ? auth.replace('Bearer ', '') : '') ?? null;
    },
  });
  call = (token, method, path, body) => {
    seq += 1;
    return handler({
      method,
      path,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `pg-flow-${String(seq).padStart(8, '0')}`,
      },
      body,
    });
  };
});
afterAll(async () => closeHarness(h));

describe('PostgreSQL service flow', () => {
  it('creates, schedules, starts, records result, completes with outbox; cross-tenant 404', async () => {
    const created = await call('sys-a', 'POST', '/v1/inspections', createBody());
    expect(created.status).toBe(201);
    const id = (created.body as { inspection_id: string }).inspection_id;
    const scheduled = await call('off1-a', 'POST', `/v1/inspections/${id}/schedule`, {
      window_start: '2026-10-07T09:00:00.000Z',
      slot_ref: 'SLOT:A1',
    });
    expect(scheduled.status).toBe(200);
    expect(await call('off1-a', 'POST', `/v1/inspections/${id}/start`)).toMatchObject({
      status: 200,
    });
    expect(
      await call('off1-a', 'POST', `/v1/inspections/${id}/result`, {
        verification_result: 'VERIFIED',
      }),
    ).toMatchObject({ status: 200 });
    const done = await call('off1-a', 'POST', `/v1/inspections/${id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      inspection_state: 'COMPLETED',
      verification_result: 'VERIFIED',
      statutory_effect: false,
    });
    const hidden = await call('off1-b', 'GET', `/v1/inspections/${id}`);
    expect(hidden.status).toBe(404);
    const outbox = await h.admin.query(
      `SELECT event_type FROM sf_inspection.outbox_event WHERE aggregate_id = $1`,
      [id],
    );
    expect(outbox.rows.map((r) => r['event_type'])).toContain('InspectionCompleted');
    expect(JSON.stringify(outbox.rows)).not.toMatch(/RECORD_APPROVED/);
  });
});
