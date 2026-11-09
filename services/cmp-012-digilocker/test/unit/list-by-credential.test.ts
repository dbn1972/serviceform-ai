import { describe, expect, it } from 'vitest';
import { makeHarness } from '../doubles/harness.js';
import {
  CONSENT_REF,
  CREDENTIAL_ID,
  DOCUMENT_TYPE_REF,
  PURPOSE_CODE,
  TENANT_B,
} from '../doubles/fixtures.js';

const body = {
  credential_id: CREDENTIAL_ID,
  consent_ref: CONSENT_REF,
  purpose_code: PURPOSE_CODE,
  document_type_ref: DOCUMENT_TYPE_REF,
  test_run_id: 'test-run-001',
};

type Listed = {
  credential_id: string;
  publish_records: Array<Record<string, unknown>>;
};

describe('listPublishRecordsForCredential (CCR-M10-003)', () => {
  it('returns the credential publish records as the published view', async () => {
    const h = makeHarness();
    const published = await h.call('POST', '/v1/digilocker-publish', body);
    expect(published.status).toBe(201);

    const r = await h.call('GET', '/v1/digilocker-publish', undefined, {
      query: { credential_id: CREDENTIAL_ID },
    });
    expect(r.status).toBe(200);
    const listed = r.body as Listed;
    expect(listed.credential_id).toBe(CREDENTIAL_ID);
    expect(listed.publish_records).toHaveLength(1);
    expect(listed.publish_records[0]).toEqual(published.body);
    expect(listed.publish_records[0]).not.toHaveProperty('consent_ref');
    expect(listed.publish_records[0]).not.toHaveProperty('tenant_id');
  });

  it('is empty for a credential that was never published', async () => {
    const h = makeHarness();
    const r = await h.call('GET', '/v1/digilocker-publish', undefined, {
      query: { credential_id: CREDENTIAL_ID },
    });
    expect(r.status).toBe(200);
    expect((r.body as Listed).publish_records).toEqual([]);
  });

  it('never reads another tenant’s records', async () => {
    const h = makeHarness();
    expect((await h.call('POST', '/v1/digilocker-publish', body)).status).toBe(201);
    h.state.ctx = { ...h.state.ctx, tenant_id: TENANT_B };
    const r = await h.call('GET', '/v1/digilocker-publish', undefined, {
      query: { credential_id: CREDENTIAL_ID },
    });
    expect(r.status).toBe(200);
    expect((r.body as Listed).publish_records).toEqual([]);
  });

  it('authorizes as digilocker:read on the credential and fails closed on deny', async () => {
    const h = makeHarness();
    h.authorizer.mode = 'deny';
    const r = await h.call('GET', '/v1/digilocker-publish', undefined, {
      query: { credential_id: CREDENTIAL_ID },
    });
    expect(r.status).toBe(403);
    expect(h.authorizer.calls.at(-1)?.action).toBe('digilocker:read');
  });

  it('fails closed when the PDP is unavailable', async () => {
    const h = makeHarness();
    h.authorizer.mode = 'throw';
    const r = await h.call('GET', '/v1/digilocker-publish', undefined, {
      query: { credential_id: CREDENTIAL_ID },
    });
    expect(r.status).toBeGreaterThanOrEqual(500);
  });

  it.each([{}, { credential_id: 'not-a-uuid' }, { credential_id: [CREDENTIAL_ID, CREDENTIAL_ID] }])(
    'refuses a missing or malformed credential_id (%j)',
    async (query) => {
      const h = makeHarness();
      const r = await h.call('GET', '/v1/digilocker-publish', undefined, { query });
      expect(r.status).toBe(400);
      expect(h.authorizer.calls).toHaveLength(0);
    },
  );
});
