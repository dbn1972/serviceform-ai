import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { IdentityService } from '../../src/commands.js';
import { SimulatedOtpAdapter } from '../../src/adapters/otp.js';
import { SimulatedIdpAdapter } from '../../src/adapters/idp.js';
import { SimulatedDigiLockerIdentityAdapter } from '../../src/adapters/digilocker.js';
import { simulatedBinding } from '../../src/bindings.js';
import { registerIdentityAccess } from '../../src/plugin.js';
import {
  IdentityContextResolver,
  IdentityPrincipalVerifier,
  type SessionDirectory,
  type SessionLookupRow,
} from '../../src/principal-verifier.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import {
  createMemoryIdentityPool,
  emptyIdentityStore,
  type MemoryIdentityStore,
} from './memory-pool.js';

const PEPPER = 'unit-pepper-not-a-secret';
const OTP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

class MemoryDirectory implements SessionDirectory {
  constructor(private readonly store: MemoryIdentityStore) {}
  async lookupByToken(_token: string): Promise<SessionLookupRow | null> {
    void this.store;
    return null;
  }
}

async function mount(trustProxy: boolean | string | string[]): Promise<FastifyInstance> {
  const store = emptyIdentityStore();
  const pool = createMemoryIdentityPool(store);
  const directory = new MemoryDirectory(store);
  const commands = new IdentityService({
    pool,
    pepper: PEPPER,
    otp: new SimulatedOtpAdapter(
      simulatedBinding({ id: OTP_ID, connector_type: 'OTP', simulator_version: 'otp-sim-1' }),
      PEPPER,
    ),
    idp: new SimulatedIdpAdapter(
      simulatedBinding({
        id: IDP_ID,
        connector_type: 'DEPARTMENT_API',
        simulator_version: 'idp-sim-1',
      }),
      PEPPER,
    ),
    digilocker: new SimulatedDigiLockerIdentityAdapter(
      simulatedBinding({
        id: DL_ID,
        connector_type: 'DIGILOCKER',
        simulator_version: 'dl-sim-1',
      }),
      PEPPER,
    ),
    authorizer: new ContractAuthorizer(),
    audit: { append: async () => undefined },
    clock: () => new Date('2026-10-04T12:00:00.000Z'),
    testRunId: 'f08-rate',
  });
  const app = Fastify({ logger: false, trustProxy });
  await registerIdentityAccess(app, {
    prefix: '/v1',
    commands,
    verifier: new IdentityPrincipalVerifier(directory),
    resolveContext: new IdentityContextResolver(directory, 'cell-01'),
    cellId: 'cell-01',
    rateLimitMax: 100,
    rateLimitWindowMs: 60_000,
  });
  return app;
}

function remaining(headers: Record<string, string | string[] | undefined>): number {
  const raw = headers['x-ratelimit-remaining'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  expect(value).toBeDefined();
  return Number(value);
}

describe('SEC F-08 trusted-proxy rate-limit key (CMP-004)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('without trustProxy, forged X-Forwarded-For does not rotate the bucket', async () => {
    app = await mount(false);
    const remainings: number[] = [];
    for (const xff of ['203.0.113.10', '203.0.113.11', '198.51.100.7']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/identity/citizen/otp/verify',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-forwarded-for': xff,
          'x-real-ip': xff,
          'idempotency-key': randomUUID(),
        },
        payload: {
          challenge_id: '0d15ba00-0000-4000-8000-000000000000',
          code: '000000',
        },
      });
      remainings.push(remaining(res.headers));
    }
    expect(remainings[1]).toBeLessThan(remainings[0] as number);
    expect(remainings[2]).toBeLessThan(remainings[1] as number);
  });

  it('with trust of the BFF hop, client address from X-Forwarded-For keys the bucket', async () => {
    app = await mount(['127.0.0.1']);
    const remainings: number[] = [];
    for (const xff of ['203.0.113.10', '203.0.113.11', '198.51.100.7']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/identity/citizen/otp/verify',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-forwarded-for': xff,
          'idempotency-key': randomUUID(),
        },
        payload: {
          challenge_id: '0d15ba00-0000-4000-8000-000000000000',
          code: '000000',
        },
      });
      remainings.push(remaining(res.headers));
    }
    // Each client address gets its own bucket, so remaining resets to max-1 each time.
    expect(remainings[0]).toBe(99);
    expect(remainings[1]).toBe(99);
    expect(remainings[2]).toBe(99);
  });

  it('with trust configured, an untrusted peer cannot rotate buckets via X-Forwarded-For', async () => {
    app = await mount(['10.0.0.5']);
    const remainings: number[] = [];
    for (const xff of ['203.0.113.10', '203.0.113.11', '198.51.100.7']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/identity/citizen/otp/verify',
        remoteAddress: '198.51.100.50',
        headers: {
          'x-forwarded-for': xff,
          'idempotency-key': randomUUID(),
        },
        payload: {
          challenge_id: '0d15ba00-0000-4000-8000-000000000000',
          code: '000000',
        },
      });
      remainings.push(remaining(res.headers));
    }
    expect(remainings[1]).toBeLessThan(remainings[0] as number);
    expect(remainings[2]).toBeLessThan(remainings[1] as number);
  });
});
