import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@serviceform/contracts';
import { SecurityError, sfSecurity } from '@serviceform/security';
import type { Pool, PoolClient } from 'pg';
import { withTenantTx } from '../src/db/tx.js';
import { complete, remember } from '../src/idempotency.js';
import { reportIncident } from '../src/incidents.js';
import { cmp048Plugin } from '../src/plugin.js';
import { activatePolicy, registerPolicy } from '../src/policy-metadata/commands.js';
import { PrivilegedAccessCommands } from '../src/privileged-access/commands.js';
import { GrantPublisher } from '../src/privileged-access/grant-publisher.js';
import type { PrivilegedAccessRecord } from '../src/privileged-access/model.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e';

const ctx: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: U2 },
  roles: ['ROLE_A'],
  jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

const sample: PrivilegedAccessRecord = {
  id: ID,
  tenant_id: T1,
  grantee_user_id: U1,
  grantee_actor_type: 'OFFICER',
  access_kind: 'BREAK_GLASS',
  purpose_code: 'SUPPORT',
  justification: 'synthetic justification',
  scope_actions: ['VIEW'],
  scope_resource_types: ['ExampleAggregate'],
  requested_by: U2,
  requested_at: '2026-10-03T09:00:00.000Z',
  status: 'REQUESTED',
  starts_at: '2026-10-03T10:00:00.000Z',
  expires_at: '2026-10-03T12:00:00.000Z',
  version: 1,
};

function mockPool(
  handler?: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number },
) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (handler) return { rowCount: 0, ...handler(sql, params) };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
  };
  return { pool: pool as unknown as Pool, client: client as unknown as PoolClient, queries };
}

function body() {
  return {
    grantee_user_id: U1,
    grantee_actor_type: 'OFFICER' as const,
    access_kind: 'BREAK_GLASS' as const,
    purpose_code: 'SUPPORT',
    justification: 'synthetic justification',
    scope_actions: ['VIEW'],
    scope_resource_types: ['ExampleAggregate'],
    starts_at: '2026-10-03T10:00:00.000Z',
    expires_at: '2026-10-03T12:00:00.000Z',
  };
}

describe('PrivilegedAccessCommands', () => {
  it('rejects missing tenant and overlong window', async () => {
    const { pool } = mockPool();
    const cmds = new PrivilegedAccessCommands(pool, undefined);
    await expect(cmds.request({ ...ctx, tenant_id: null }, body())).rejects.toBeInstanceOf(
      SecurityError,
    );
    await expect(
      cmds.request(ctx, { ...body(), expires_at: '2026-10-04T12:00:00.000Z' }),
    ).rejects.toBeInstanceOf(SecurityError);
  });

  it('inserts REQUESTED, writes audit outbox, honours idempotent replay', async () => {
    let idemHits = 0;
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('idempotency_record') && sql.startsWith('SELECT')) {
        idemHits += 1;
        if (idemHits > 1) {
          return {
            rows: [
              { request_fingerprint: expect.anything(), status: 'COMPLETED', response_ref: ID },
            ],
          };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });
    const cmds = new PrivilegedAccessCommands(pool, undefined);
    const first = await cmds.request(ctx, body(), 'key-1');
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      queries.some((q) => q.sql.includes('INSERT INTO sf_security.privileged_access_record')),
    ).toBe(true);
    expect(queries.some((q) => q.sql.includes('outbox_event'))).toBe(true);
  });

  it('approve and review persist and optionally push grants', async () => {
    const publisher = { push: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    const { pool } = mockPool((sql) => {
      if (sql.includes('SELECT * FROM sf_security.privileged_access_record')) {
        return { rows: [{ ...sample, status: 'APPROVED', approved_by: U2 }] };
      }
      return { rows: [] };
    });
    const cmds = new PrivilegedAccessCommands(pool, publisher as never);
    const row = await cmds.approve(ctx, ID);
    expect(row.status).toBe('APPROVED');
    expect(publisher.push).toHaveBeenCalledOnce();
    await cmds.review(ctx, ID, 'OK');
    expect(publisher.remove).not.toHaveBeenCalled();
  });

  it('revoke retries grant delete and emits incident on failure (002-34)', async () => {
    const publisher = {
      push: vi.fn(),
      remove: vi.fn(async () => {
        throw new Error('opa down');
      }),
    };
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('SELECT * FROM sf_security.privileged_access_record')) {
        return { rows: [sample] };
      }
      return { rows: [] };
    });
    const cmds = new PrivilegedAccessCommands(pool, publisher as never);
    await expect(cmds.revoke(ctx, ID)).rejects.toThrow(/opa down/);
    expect(publisher.remove).toHaveBeenCalledTimes(5);
    expect(
      queries.some(
        (q) => q.sql.includes('outbox_event') && q.params.includes('sf.security.events.v1'),
      ),
    ).toBe(true);
  });

  it('approve/revoke 404 when missing', async () => {
    const { pool } = mockPool(() => ({ rows: [] }));
    const cmds = new PrivilegedAccessCommands(pool, undefined);
    await expect(cmds.approve(ctx, ID)).rejects.toBeInstanceOf(SecurityError);
    await expect(cmds.revoke(ctx, ID)).rejects.toBeInstanceOf(SecurityError);
    await expect(cmds.approve({ ...ctx, tenant_id: null }, ID)).rejects.toBeInstanceOf(
      SecurityError,
    );
    await expect(cmds.revoke({ ...ctx, tenant_id: null }, ID)).rejects.toBeInstanceOf(
      SecurityError,
    );
    await expect(cmds.review({ ...ctx, tenant_id: null }, ID, 'x')).rejects.toBeInstanceOf(
      SecurityError,
    );
  });
});

describe('idempotency remember/complete', () => {
  it('replays same fingerprint and conflicts on a different one', async () => {
    const { client } = mockPool((sql) => {
      if (sql.includes('SELECT request_fingerprint')) {
        return {
          rows: [{ request_fingerprint: 'sha256:aaa', status: 'COMPLETED', response_ref: ID }],
        };
      }
      return { rows: [] };
    });
    const replay = await remember(client, {
      tenantId: T1,
      principalId: U2,
      endpoint: 'POST /privileged-access',
      key: 'k',
      fingerprint: 'sha256:aaa',
    });
    expect(replay.replay).toBe(true);
    await expect(
      remember(client, {
        tenantId: T1,
        principalId: U2,
        endpoint: 'POST /privileged-access',
        key: 'k',
        fingerprint: 'sha256:bbb',
      }),
    ).rejects.toBeInstanceOf(SecurityError);
    await complete(client, {
      tenantId: T1,
      principalId: U2,
      endpoint: 'POST /privileged-access',
      key: 'k',
      responseRef: ID,
    });
  });

  it('uses the platform table when tenant is null', async () => {
    const { client, queries } = mockPool(() => ({ rows: [] }));
    const mem = await remember(client, {
      tenantId: null,
      principalId: U2,
      endpoint: 'POST /policy-revisions',
      key: 'k',
      fingerprint: 'sha256:ccc',
    });
    expect(mem.replay).toBe(false);
    expect(queries.some((q) => q.sql.includes('idempotency_record_platform'))).toBe(true);
    await complete(client, {
      tenantId: null,
      principalId: U2,
      endpoint: 'POST /policy-revisions',
      key: 'k',
      responseRef: ID,
    });
  });
});

describe('policy metadata and incidents', () => {
  it('registers, activates (platform outbox), and reports incidents', async () => {
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM sf_security.security_policy_metadata')) {
        return {
          rows: [
            {
              bundle_name: 'sf',
              published_by: U1,
              revision: 'w1',
              content_sha256: 'a'.repeat(64),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const reg = await registerPolicy(pool, ctx, {
      bundle_name: 'sf',
      revision: 'w1',
      content_sha256: 'a'.repeat(64),
      roots: ['sf', 'system/log'],
      test_report_sha256: 'b'.repeat(64),
    });
    expect(reg.id).toBeTruthy();
    await activatePolicy(pool, ctx, ID);
    expect(queries.some((q) => q.sql.includes('outbox_event_platform'))).toBe(true);
    const inc = await reportIncident(pool, ctx, {
      incident_code: 'FORGED_HEADER',
      reason_code: 'TENANT_MISMATCH',
    });
    expect(inc.id).toBeTruthy();
    const { pool: missing } = mockPool(() => ({ rows: [] }));
    await expect(
      activatePolicy(missing, ctx, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(SecurityError);
  });
});

describe('withTenantTx', () => {
  it('commits settings then rolls back on failure', async () => {
    const { pool, client } = mockPool();
    await withTenantTx(pool, ctx, async () => 'ok');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    const { pool: p2, client: c2 } = mockPool();
    await expect(
      withTenantTx(p2, ctx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow(/boom/);
    expect(c2.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('GrantPublisher', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function listen(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<{ url: string; close: () => void }> {
    return new Promise((resolve) => {
      const s = createServer(handler);
      server = s;
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () => server?.close(),
        });
      });
    });
  }

  it('pushes and removes grants; fails closed on non-404', async () => {
    const stub = await listen((req, res) => {
      if (req.method === 'PUT') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'DELETE') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    const pub = new GrantPublisher(stub.url, 'grant-publisher');
    await pub.push(T1, U1, {
      status: 'APPROVED',
      approved_by: U2,
      grantee_user_id: U1,
      tenant_id: T1,
      starts_at: sample.starts_at,
      expires_at: sample.expires_at,
      scope_actions: ['VIEW'],
      scope_resource_types: ['ExampleAggregate'],
    });
    await pub.remove(T1, U1);
    stub.close();
  });

  it('treats leftover grant document as failure', async () => {
    const stub = await listen((req, res) => {
      if (req.method === 'DELETE') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: { status: 'APPROVED' } }));
    });
    const pub = new GrantPublisher(stub.url, 'grant-publisher');
    await expect(pub.remove(T1, U1)).rejects.toThrow(/still present/);
    stub.close();
  });
});

describe('cmp048Plugin routes', () => {
  it('wires privileged-access request through injected commands', async () => {
    const commands = {
      request: vi.fn(async () => ({ id: ID })),
      approve: vi.fn(async () => ({ ...sample, status: 'APPROVED' })),
      revoke: vi.fn(async () => undefined),
      review: vi.fn(async () => undefined),
    };
    const { pool } = mockPool();
    const f = Fastify({ logger: false });
    f.setErrorHandler((err, _req, reply) => {
      if (err instanceof SecurityError)
        return reply.code(err.statusCode).send({ error_code: err.code });
      return reply.code(500).send({ error_code: 'SF-SYS-001' });
    });
    await f.register(sfSecurity, {
      verifier: {
        verify: async () => ({
          subject_id: U2,
          actor_type: 'OFFICER' as const,
          assurance: 'MFA' as const,
        }),
      },
      resolver: {
        resolve: async () => ({
          tenant_id: T1,
          cell_id: 'cell-01',
          actor: { type: 'OFFICER' as const, id: U2 },
          roles: ['ROLE_A'],
          jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
          auth_assurance: 'MFA' as const,
        }),
      },
      pdp: {
        decide: async () => ({
          allow: true,
          reason_code: 'ALLOW',
          policy_revision: 'w1',
          decision_id: ID,
        }),
      },
      cellId: 'cell-01',
    });
    await f.register(cmp048Plugin, { prefix: '/v1/security', pool, commands: commands as never });
    const res = await f.inject({
      method: 'POST',
      url: '/v1/security/privileged-access',
      headers: { authorization: 'Bearer pep', 'idempotency-key': 'k1' },
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    expect(commands.request).toHaveBeenCalled();
    const appr = await f.inject({
      method: 'POST',
      url: `/v1/security/privileged-access/${ID}/approve`,
      headers: { authorization: 'Bearer pep' },
    });
    expect(appr.statusCode).toBe(200);
    await f.close();
  });
});
