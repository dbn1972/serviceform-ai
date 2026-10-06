import { describe, expect, it } from 'vitest';
import { createInspectionHandler } from '../../src/http/handler.js';
import { ctxFor, createBody, OFFICER_1, WORKFLOW_SYSTEM } from '../doubles/fixtures.js';
import { makeService } from '../doubles/harness.js';
import type { Ctx } from '../doubles/harness.js';

describe('HTTP handler', () => {
  it('creates an inspection and refuses X-Tenant-ID', async () => {
    const { service } = makeService();
    const system = ctxFor(
      WORKFLOW_SYSTEM,
      {
        roles: ['WORKFLOW_ENGINE'],
        organisation_id: undefined,
        office_id: undefined,
        jurisdiction_ids: [],
      },
      'SYSTEM',
    ) as Ctx;
    const handler = createInspectionHandler({
      service,
      resolveContext: async () => system,
    });
    const created = await handler({
      method: 'POST',
      path: '/v1/inspections',
      headers: { 'idempotency-key': 'http-create-01' },
      body: createBody(),
    });
    expect(created.status).toBe(201);
    const denied = await handler({
      method: 'POST',
      path: '/v1/inspections',
      headers: { 'idempotency-key': 'http-create-02', 'x-tenant-id': 'nope' },
      body: createBody(),
    });
    expect(denied.status).toBe(403);
    const officer = ctxFor(OFFICER_1) as Ctx;
    const read = createInspectionHandler({
      service,
      resolveContext: async () => officer,
    });
    const id = (created.body as { inspection_id: string }).inspection_id;
    const got = await read({
      method: 'GET',
      path: `/v1/inspections/${id}`,
      headers: {},
    });
    expect(got.status).toBe(200);
  });
});
