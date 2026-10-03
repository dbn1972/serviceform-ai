import { describe, expect, it } from 'vitest';
import { OpaPdpClient, assertOpaUrl } from '../src/pep/pdp-client.js';
import { jsonAllow, startStubOpa } from './helpers/stub-opa.js';
import type { AuthzDecisionInput } from '@serviceform/contracts';
import { T1, U1, TRACE } from './helpers/fakes.js';

const input: AuthzDecisionInput = {
  subject: {
    user_id: U1,
    actor_type: 'OFFICER',
    tenant_id: T1,
    roles: ['ROLE_A'],
    jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
  },
  resource: { resource_type: 'ExampleAggregate', tenant_id: T1, classification: 'TENANT_SCOPED' },
  action: 'VIEW',
  environment: { request_time: '2026-06-01T00:00:00Z', trace_id: TRACE },
};

describe('OpaPdpClient fail-closed (002-18 P5-P9, 002-20, 002-21)', () => {
  it('P5 ECONNREFUSED -> PDP_UNAVAILABLE', async () => {
    const c = new OpaPdpClient({ opaUrl: 'http://127.0.0.1:1', timeoutMs: 50 });
    const d = await c.decide(input);
    expect(d.allow).toBe(false);
    expect(d.reason_code).toBe('PDP_UNAVAILABLE');
  });

  it('P6 timeout -> PDP_TIMEOUT', async () => {
    const stub = await startStubOpa(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    const c = new OpaPdpClient({ opaUrl: stub.url, timeoutMs: 20 });
    const d = await c.decide(input);
    expect(d.allow).toBe(false);
    expect(['PDP_TIMEOUT', 'PDP_UNAVAILABLE']).toContain(d.reason_code);
    await stub.close();
  });

  it('P7 empty result -> POLICY_UNDEFINED', async () => {
    const stub = await startStubOpa((_r, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    const c = new OpaPdpClient({ opaUrl: stub.url });
    const d = await c.decide(input);
    expect(d.allow).toBe(false);
    expect(d.reason_code).toBe('POLICY_UNDEFINED');
    await stub.close();
  });

  it('P7 allow string true denied', async () => {
    const stub = await startStubOpa((_r, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ result: { allow: 'true', reason_code: 'ALLOW', policy_revision: 'w1' } }),
      );
    });
    const c = new OpaPdpClient({ opaUrl: stub.url });
    const d = await c.decide(input);
    expect(d.allow).toBe(false);
    await stub.close();
  });

  it('P7 text/html denied', async () => {
    const stub = await startStubOpa((_r, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('{"result":{"allow":true,"reason_code":"ALLOW","policy_revision":"w1"}}');
    });
    const c = new OpaPdpClient({ opaUrl: stub.url });
    const d = await c.decide(input);
    expect(d.allow).toBe(false);
    await stub.close();
  });

  it('002-21 rejects userinfo and bad scheme', () => {
    expect(() => assertOpaUrl('http://user:pass@127.0.0.1:8181')).toThrow(/userinfo/);
    expect(() => assertOpaUrl('ftp://127.0.0.1')).toThrow(/scheme/);
    expect(() => assertOpaUrl('')).toThrow();
  });

  it('002-21 does not follow redirect', async () => {
    const stub = await startStubOpa((_r, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'http://127.0.0.1/evil');
      res.end();
    });
    const c = new OpaPdpClient({ opaUrl: stub.url });
    const d = await c.decide(input);
    expect(d.allow).toBe(false);
    await stub.close();
  });

  it('positive control: valid allow', async () => {
    const stub = await startStubOpa((_r, res) => jsonAllow(res));
    const c = new OpaPdpClient({ opaUrl: stub.url });
    const d = await c.decide(input);
    expect(d.allow).toBe(true);
    await stub.close();
  });
});
