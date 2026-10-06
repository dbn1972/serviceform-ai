import { describe, expect, it } from 'vitest';
import { validate } from '../../src/contracts.js';
import { createAppealHandler, type HttpRequest } from '../../src/http/handler.js';
import { ctxFor, fileBody, OFFICER_1, TENANT_A, CITIZEN_1 } from '../doubles/fixtures.js';
import { makeService } from '../doubles/harness.js';

function setup() {
  const h = makeService();
  const contexts = new Map<string, ReturnType<typeof ctxFor>>();
  contexts.set('officer', ctxFor(OFFICER_1));
  contexts.set('citizen', ctxFor(CITIZEN_1, { roles: ['CITIZEN'] }, 'CITIZEN'));
  contexts.set('no-tenant', ctxFor(OFFICER_1, { tenant_id: null }));
  const handler = createAppealHandler({
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
  if (method === 'POST' && !('idempotency-key' in extra)) {
    headers['idempotency-key'] = `http-key-${String(n).padStart(6, '0')}`;
  }
  return { method, path, headers, body };
}

describe('transport-neutral handler', () => {
  it('serves file + get and every error body matches SF-CON-ERROR-RESPONSE', async () => {
    const { handler } = setup();
    const created = await handler(req('citizen', 'POST', '/v1/appeals', fileBody()));
    expect(created.status).toBe(201);
    const id = (created.body as { appeal_id: string }).appeal_id;
    expect(created.headers['cache-control']).toBe('private, no-store');
    expect((await handler(req('officer', 'GET', `/v1/appeals/${id}`))).status).toBe(200);

    const deniedHeader = await handler(
      req('officer', 'GET', `/v1/appeals/${id}`, undefined, { 'x-tenant-id': TENANT_A }),
    );
    expect(deniedHeader.status).toBe(403);
    expect(validate('error-response', deniedHeader.body).valid).toBe(true);

    const missing = await handler(
      req('officer', 'POST', '/v1/appeals', fileBody(), { 'idempotency-key': '' }),
    );
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(validate('error-response', missing.body).valid).toBe(true);

    const unknown = await handler(req('officer', 'GET', '/v1/nope'));
    expect(unknown.status).toBe(404);
    expect(validate('error-response', unknown.body).valid).toBe(true);

    const noTenant = await handler(req('no-tenant', 'GET', `/v1/appeals/${id}`));
    expect(noTenant.status).toBe(401);
  });
});
