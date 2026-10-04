import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR_CITIZEN,
  bearer,
  buildApp,
  closeHarness,
  key,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-005 API flows', () => {
  it('purpose-bound profile write/read, simulated import, tenant isolation', async () => {
    const { app, consent } = await buildApp(h);
    try {
      const ensure = await app.inject({
        method: 'PUT',
        url: `/v1/profiles/${ACTOR_CITIZEN}`,
        headers: bearer('officer-t1', { 'idempotency-key': key('ens') }),
        payload: {},
      });
      expect(ensure.statusCode).toBe(200);

      const upsertKey = key('up');
      const upsertBody = {
        purpose_code: 'PROFILE_ACCESS',
        claims: [
          { section_code: 'IDENTITY', claim_code: 'DISPLAY_NAME', value_text: 'SECRET_NAME' },
        ],
      };
      const up1 = await app.inject({
        method: 'PUT',
        url: `/v1/profiles/${ACTOR_CITIZEN}/claims`,
        headers: bearer('officer-t1', { 'idempotency-key': upsertKey }),
        payload: upsertBody,
      });
      expect(up1.statusCode).toBe(200);
      const up2 = await app.inject({
        method: 'PUT',
        url: `/v1/profiles/${ACTOR_CITIZEN}/claims`,
        headers: bearer('officer-t1', { 'idempotency-key': upsertKey }),
        payload: upsertBody,
      });
      expect(up2.statusCode).toBe(200);
      expect(up2.json()).toEqual(up1.json());

      const read = await app.inject({
        method: 'GET',
        url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
        headers: bearer('officer-t1'),
      });
      expect(read.statusCode).toBe(200);
      expect(JSON.stringify(read.json())).toContain('SECRET_NAME');

      consent.allowed = false;
      const denied = await app.inject({
        method: 'GET',
        url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
        headers: bearer('officer-t1'),
      });
      expect(denied.statusCode).toBe(403);
      expect(JSON.stringify(denied.json())).not.toContain('SECRET_NAME');
      consent.allowed = true;

      const imp = await app.inject({
        method: 'POST',
        url: `/v1/profiles/${ACTOR_CITIZEN}/verified-claims/import`,
        headers: bearer('officer-t1', { 'idempotency-key': key('imp') }),
        payload: {
          purpose_code: 'PROFILE_ACCESS',
          scenario: 'happy',
          test_run_id: 'run-int-1',
        },
      });
      expect(imp.statusCode).toBe(200);
      expect(imp.json()).toMatchObject({ simulation: { simulation: true } });

      const forged = await app.inject({
        method: 'GET',
        url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
        headers: { ...bearer('officer-t1'), 'x-tenant-id': T2 },
      });
      expect(forged.statusCode).toBe(403);

      const otherTenant = await app.inject({
        method: 'GET',
        url: `/v1/profiles/${ACTOR_CITIZEN}?purpose_code=PROFILE_ACCESS`,
        headers: bearer('officer-t2'),
      });
      expect([403, 404]).toContain(otherTenant.statusCode);
      expect(JSON.stringify(otherTenant.json())).not.toContain('SECRET_NAME');

      const events = await h.admin.query<{ event_type: string; envelope: unknown }>(
        `SELECT event_type, envelope FROM sf_citizen_profile.outbox_event WHERE tenant_id = $1`,
        [T1],
      );
      const types = events.rows.map((r) => r.event_type);
      expect(types).toContain('ProfileClaimUpserted');
      expect(types).toContain('VerifiedClaimsImported');
      expect(JSON.stringify(events.rows)).not.toContain('SECRET_NAME');
    } finally {
      await app.close();
    }
  });
});
