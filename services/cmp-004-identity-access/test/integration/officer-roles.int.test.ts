import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintSimulatedIdpAssertion } from '../../src/adapters/idp.js';
import { IdentityContextResolver, PgSessionDirectory } from '../../src/principal-verifier.js';
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
    const resolver = new IdentityContextResolver(new PgSessionDirectory(h.rt), 'cell-01');
    const ctx = await resolver.resolve(
      { subject_id: officerId, actor_type: 'OFFICER', assurance: 'MFA' },
      { cellId: 'cell-01' },
    );
    expect(ctx?.tenant_id).toBe(T1);
    expect(ctx?.roles).toEqual(['LAB_CASE_REVIEWER']);
    await app.close();
  });
});
