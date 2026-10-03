import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { SecurityError, sfSecurity } from '../src/index.js';
import { OpaPdpClient } from '../src/pep/pdp-client.js';
import { CELL, T2, context, stubResolver, stubVerifier } from './helpers/fakes.js';
import { jsonAllow, startStubOpa, type StubOpa } from './helpers/stub-opa.js';

async function app(opts: { pdp?: OpaPdpClient; publicRoute?: boolean } = {}) {
  const f = Fastify({ logger: false });
  f.setErrorHandler((err, _req, reply) => {
    if (err instanceof SecurityError) {
      return reply.code(err.statusCode).send({ error_code: err.code, message: err.message });
    }
    return reply.code(500).send({ error_code: 'SF-SYS-001' });
  });
  const stub = await startStubOpa((_req, res) => jsonAllow(res));
  const pdp = opts.pdp ?? new OpaPdpClient({ opaUrl: stub.url, timeoutMs: 200 });
  await f.register(sfSecurity, {
    verifier: stubVerifier(),
    resolver: stubResolver(),
    pdp,
    cellId: CELL,
  });
  f.get('/work', {
    config: {
      sfAuthz: {
        action: 'VIEW',
        resource: (req) => ({
          resource_type: 'ExampleAggregate',
          tenant_id: req.sfContext?.tenant_id ?? null,
          classification: 'TENANT_SCOPED',
        }),
      },
    },
    handler: async () => ({ ok: true }),
  });
  if (opts.publicRoute) {
    f.get('/pub', { config: { sfPublic: true }, handler: async () => ({ pub: true }) });
  }
  return { f, stub };
}

let opened: StubOpa | undefined;

afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

describe('sfSecurity plugin (002-18)', () => {
  it('P1 no principal -> 401 without OPA call', async () => {
    const stub = await startStubOpa((_r, res) => jsonAllow(res));
    opened = stub;
    const f = Fastify({ logger: false });
    f.setErrorHandler((err, _req, reply) => {
      if (err instanceof SecurityError)
        return reply.code(err.statusCode).send({ error_code: err.code });
      return reply.code(500).send({});
    });
    await f.register(sfSecurity, {
      verifier: stubVerifier(null),
      resolver: stubResolver(),
      pdp: new OpaPdpClient({ opaUrl: stub.url }),
      cellId: CELL,
    });
    f.get('/work', {
      config: {
        sfAuthz: {
          action: 'VIEW',
          resource: () => ({
            resource_type: 'ExampleAggregate',
            tenant_id: null,
            classification: 'TENANT_SCOPED' as const,
          }),
        },
      },
      handler: async () => ({ ok: true }),
    });
    const res = await f.inject({ method: 'GET', url: '/work' });
    expect(res.statusCode).toBe(401);
    expect(stub.calls).toBe(0);
    await f.close();
  });

  it('P2 resolver null -> 401 SF-TEN-001', async () => {
    const stub = await startStubOpa((_r, res) => jsonAllow(res));
    opened = stub;
    const f = Fastify({ logger: false });
    f.setErrorHandler((err, _req, reply) => {
      if (err instanceof SecurityError)
        return reply.code(err.statusCode).send({ error_code: err.code });
      return reply.code(500).send({});
    });
    await f.register(sfSecurity, {
      verifier: stubVerifier(),
      resolver: stubResolver(null),
      pdp: new OpaPdpClient({ opaUrl: stub.url }),
      cellId: CELL,
    });
    f.get('/work', {
      config: {
        sfAuthz: {
          action: 'VIEW',
          resource: () => ({ resource_type: 'ExampleAggregate', tenant_id: null }),
        },
      },
      handler: async () => ({ ok: true }),
    });
    const res = await f.inject({ method: 'GET', url: '/work' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error_code).toBe('SF-TEN-001');
    await f.close();
  });

  it('P3 forged x-tenant-id -> 403', async () => {
    const { f, stub } = await app();
    opened = stub;
    const res = await f.inject({ method: 'GET', url: '/work', headers: { 'x-tenant-id': T2 } });
    expect(res.statusCode).toBe(403);
    await f.close();
  });

  it('P4 undeclared route fails boot', async () => {
    const stub = await startStubOpa((_r, res) => jsonAllow(res));
    opened = stub;
    const f = Fastify({ logger: false });
    await f.register(sfSecurity, {
      verifier: stubVerifier(),
      resolver: stubResolver(context()),
      pdp: new OpaPdpClient({ opaUrl: stub.url }),
      cellId: CELL,
    });
    expect(() => f.get('/bare', async () => ({ ok: true }))).toThrow(/sfAuthz or sfPublic/);
    await f.close();
  });

  it('allows a declared route when OPA allows', async () => {
    const { f, stub } = await app();
    opened = stub;
    const res = await f.inject({ method: 'GET', url: '/work' });
    expect(res.statusCode).toBe(200);
    await f.close();
  });

  it('002-19 local tenant pre-check does not call OPA', async () => {
    const stub = await startStubOpa((_r, res) => jsonAllow(res));
    opened = stub;
    const f = Fastify({ logger: false });
    f.setErrorHandler((err, _req, reply) => {
      if (err instanceof SecurityError)
        return reply.code(err.statusCode).send({ error_code: err.code });
      return reply.code(500).send({});
    });
    await f.register(sfSecurity, {
      verifier: stubVerifier(),
      resolver: stubResolver(),
      pdp: new OpaPdpClient({ opaUrl: stub.url }),
      cellId: CELL,
    });
    f.get('/x', {
      config: {
        sfAuthz: {
          action: 'VIEW',
          resource: () => ({
            resource_type: 'ExampleAggregate',
            tenant_id: T2,
            classification: 'TENANT_SCOPED' as const,
          }),
        },
      },
      handler: async () => ({ ok: true }),
    });
    const res = await f.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(403);
    expect(stub.calls).toBe(0);
    await f.close();
  });

  it('002-23 sfPublic+sfAuthz fails boot', async () => {
    const stub = await startStubOpa((_r, res) => jsonAllow(res));
    opened = stub;
    const f = Fastify({ logger: false });
    await f.register(sfSecurity, {
      verifier: stubVerifier(),
      resolver: stubResolver(),
      pdp: new OpaPdpClient({ opaUrl: stub.url }),
      cellId: CELL,
    });
    expect(() =>
      f.get('/both', {
        config: {
          sfPublic: true,
          sfAuthz: {
            action: 'VIEW',
            resource: () => ({ resource_type: 'ExampleAggregate', tenant_id: null }),
          },
        },
        handler: async () => ({ ok: true }),
      }),
    ).toThrow(/both/);
    await f.close();
  });

  it('002-25 deep freeze throws on mutation', async () => {
    const { f, stub } = await app();
    opened = stub;
    f.get('/mut', {
      config: {
        sfAuthz: {
          action: 'VIEW',
          resource: (req) => ({
            resource_type: 'ExampleAggregate',
            tenant_id: req.sfContext?.tenant_id ?? null,
            classification: 'TENANT_SCOPED',
          }),
        },
      },
      handler: async (req) => {
        expect(() => {
          (req.sfContext as { tenant_id: string }).tenant_id = T2;
        }).toThrow();
        expect(() => {
          req.sfContext?.roles.push('ADMIN');
        }).toThrow();
        return { ok: true };
      },
    });
    const res = await f.inject({ method: 'GET', url: '/mut' });
    expect(res.statusCode).toBe(200);
    await f.close();
  });
});
