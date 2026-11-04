import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintSimulatedIdpAssertion } from '../../src/adapters/idp.js';
import {
  IdentityContextResolver,
  IdentityPrincipalVerifier,
  PgSessionDirectory,
} from '../../src/principal-verifier.js';
import { buildApp, closeHarness, PEPPER, setupHarness, T1, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-004 officer context carries the session role codes (PostgreSQL)', () => {
  it('resolves exactly the issued roles, never an invented default', async () => {
    const { app } = await buildApp(h);
    const officerId = randomUUID();
    const assertion = mintSimulatedIdpAssertion(PEPPER, {
      sub: `officer-${officerId}`,
      tenant_id: T1,
      officer_id: officerId,
      roles: ['LAB_CASE_REVIEWER'],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/officer/sessions',
      payload: { assertion },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    const token = (res.json() as { session_token: string }).session_token;
    const directory = new PgSessionDirectory(h.rt);
    const principal = await new IdentityPrincipalVerifier(directory).verify({
      headers: { authorization: `Bearer ${token}` },
    } as never);
    const resolver = new IdentityContextResolver(directory, 'cell-01');
    const ctx = principal ? await resolver.resolve(principal, { cellId: 'cell-01' }) : null;
    expect(ctx?.tenant_id).toBe(T1);
    expect(ctx?.roles).toEqual(['LAB_CASE_REVIEWER']);
    await app.close();
  });
});
