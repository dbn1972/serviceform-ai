import { describe, expect, it } from 'vitest';
import { validate } from '../../src/contracts.js';
import { createTaskHandler, type HttpRequest } from '../../src/http/handler.js';
import { ctxFor, createBody, OFFICER_1, TENANT_A, WORKFLOW_SYSTEM } from '../doubles/fixtures.js';
import { makeService } from '../doubles/harness.js';

function setup() {
  const h = makeService();
  const contexts = new Map<string, ReturnType<typeof ctxFor>>();
  contexts.set('officer', ctxFor(OFFICER_1));
  contexts.set(
    'system',
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
  );
  contexts.set('no-tenant', ctxFor(OFFICER_1, { tenant_id: null }));
  const handler = createTaskHandler({
    service: h.service,
    resolveContext: async (req) => {
      const auth = req.headers['authorization'];
      const token = typeof auth === 'string' ? auth.replace('Bearer ', '') : '';
      return contexts.get(token) ?? null;
    },
  });
  return { ...h, handler };
}

let n = 0;
function req(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): HttpRequest {
  n += 1;
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...extra };
  if (method === 'POST' && !('idempotency-key' in extra))
    headers['idempotency-key'] = `http-key-${String(n).padStart(6, '0')}`;
  return { method, path, headers, body };
}

describe('transport-neutral handler', () => {
  it('serves the lifecycle and every error body matches SF-CON-ERROR-RESPONSE', async () => {
    const { handler } = setup();
    const created = await handler(req('system', 'POST', '/v1/tasks', createBody()));
    expect(created.status).toBe(201);
    const id = (created.body as { task_id: string }).task_id;
    expect(created.headers['cache-control']).toBe('private, no-store');

    const avail = await handler(req('officer', 'GET', '/v1/tasks/available'));
    expect((avail.body as { items: unknown[] }).items).toHaveLength(1);
    const claim = await handler(req('officer', 'POST', `/v1/tasks/${id}/claim`));
    expect(claim.status).toBe(200);
    expect((await handler(req('officer', 'GET', `/v1/tasks/${id}`))).status).toBe(200);
    expect(
      (
        (await handler(req('officer', 'GET', `/v1/tasks/${id}/history`))).body as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(2);
    expect((await handler(req('officer', 'POST', `/v1/tasks/${id}/unclaim`))).status).toBe(200);
    await handler(req('officer', 'POST', `/v1/tasks/${id}/claim`));
    expect(
      (
        await handler(
          req('officer', 'POST', `/v1/tasks/${id}/complete`, { outcome: 'FORWARD_TO_APPROVAL' }),
        )
      ).status,
    ).toBe(200);
    const again = await handler(req('officer', 'POST', `/v1/tasks/${id}/claim`));
    expect(again.status).toBe(409);
    expect(validate('error-response', again.body).valid).toBe(true);
  });

  it('exposes reassign and cancel routes', async () => {
    const { handler } = setup();
    const created = await handler(req('system', 'POST', '/v1/tasks', createBody()));
    const id = (created.body as { task_id: string }).task_id;
    const org = '00000000-0000-4000-8000-000000000099';
    const re = await handler(
      req('officer', 'POST', `/v1/tasks/${id}/reassign`, {
        assignment: {
          role_code: 'SCRUTINY_OFFICER',
          organisation_id: org,
          jurisdiction_id:
            createBody().assignment &&
            (createBody().assignment as { jurisdiction_id: string }).jurisdiction_id,
        },
      }),
    );
    expect(re.status).toBe(200);
    expect(
      (
        await handler(
          req('system', 'POST', `/v1/tasks/${id}/cancel`, { outcome: 'CASE_WITHDRAWN' }),
        )
      ).status,
    ).toBe(200);
  });

  it('refuses tenant-identifying headers before touching context or service', async () => {
    const { handler, authz } = setup();
    for (const header of [
      'x-tenant-id',
      'X-SF-Tenant',
      'x-roles',
      'x-org-id',
      'x-actor-type',
      'x-assurance',
    ]) {
      const res = await handler(
        req('officer', 'GET', '/v1/tasks/available', undefined, { [header]: TENANT_A }),
      );
      expect(res.status).toBe(403);
      expect((res.body as { error_code: string }).error_code).toBe('SF-TEN-002');
    }
    const fwd = await handler(
      req('officer', 'GET', '/v1/tasks/available', undefined, {
        forwarded: `for=1.2.3.4;tenant=${TENANT_A}`,
      }),
    );
    expect(fwd.status).toBe(403);
    const benign = await handler(
      req('officer', 'GET', '/v1/tasks/available', undefined, { forwarded: 'for=1.2.3.4' }),
    );
    expect(benign.status).toBe(200);
    expect(authz.calls.length).toBe(1);
  });

  it('rejects client tenant in the body, missing/invalid idempotency keys, unknown routes and bad ids', async () => {
    const { handler } = setup();
    const tenantBody = await handler(
      req('system', 'POST', '/v1/tasks', createBody({ tenant_id: TENANT_A })),
    );
    expect(tenantBody.status).toBe(403);
    const noKey = await handler({
      method: 'POST',
      path: '/v1/tasks',
      headers: { authorization: 'Bearer system' },
      body: createBody(),
    });
    expect(noKey.status).toBe(400);
    const shortKey = await handler(
      req('system', 'POST', '/v1/tasks', createBody(), { 'idempotency-key': 'short' }),
    );
    expect(shortKey.status).toBe(400);
    expect((await handler(req('system', 'DELETE', '/v1/tasks'))).status).toBe(404);
    expect((await handler(req('system', 'GET', '/v1/other'))).status).toBe(404);
    expect(
      (await handler(req('officer', 'GET', '/v1/tasks/00000000-0000-4000-8000-0000000000aa')))
        .status,
    ).toBe(404);
    expect((await handler(req('officer', 'GET', '/v1/tasks/available', undefined))).status).toBe(
      200,
    );
    const bad = await handler({
      method: 'GET',
      path: '/v1/tasks/available',
      headers: { authorization: 'Bearer officer' },
      query: { limit: 'abc' },
    });
    expect(bad.status).toBe(400);
  });

  it('requires an authenticated server-derived tenant context', async () => {
    const { handler } = setup();
    expect((await handler(req('nobody', 'GET', '/v1/tasks/available'))).status).toBe(401);
    expect((await handler(req('no-tenant', 'GET', '/v1/tasks/available'))).status).toBe(401);
  });

  it('maps unexpected failures to a safe SF-SYS-001 without internals', async () => {
    const h = setup();
    const boom = createTaskHandler({
      service: h.service,
      resolveContext: async () => {
        throw new Error('db password=hunter2');
      },
    });
    const res = await boom(req('officer', 'GET', '/v1/tasks/available'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
