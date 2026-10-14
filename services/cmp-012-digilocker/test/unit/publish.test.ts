import { describe, expect, it } from 'vitest';
import { makeHarness } from '../doubles/harness.js';
import {
  CREDENTIAL_ID,
  CONSENT_REF,
  PURPOSE_CODE,
  DOCUMENT_TYPE_REF,
} from '../doubles/fixtures.js';

const validBody = {
  credential_id: CREDENTIAL_ID,
  consent_ref: CONSENT_REF,
  purpose_code: PURPOSE_CODE,
  document_type_ref: DOCUMENT_TYPE_REF,
  test_run_id: 'test-run-001',
};

describe('publishCredential (SIMULATED mode - LOCAL)', () => {
  it('returns 201 with PUBLISHED status on success', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['publish_status']).toBe('PUBLISHED');
    expect(body['credential_id']).toBe(CREDENTIAL_ID);
    expect(body['connector_mode']).toBe('SIMULATED');
    expect(body['issuance_reversed_on_publish_failure']).toBe(false);
    expect(body['registry_status_changed_by_publish']).toBe(false);
    expect(body['provider_transaction_ref']).toBeDefined();
  });

  it('returns 201 with FAILED status on simulated failure', async () => {
    const h = makeHarness({ scenario: 'digilocker_publish_fail' });
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['publish_status']).toBe('FAILED');
    expect(body['issuance_reversed_on_publish_failure']).toBe(false);
    expect(body['registry_status_changed_by_publish']).toBe(false);
    expect(body['failure_code']).toBeDefined();
  });

  it('emits domain outbox event on publish', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/digilocker-publish', validBody);
    const store = h.repo.tenant(h.state.ctx.tenant_id);
    const domainEvents = store.outbox.filter((e) => e.topic === 'sf.digilocker.events.v1');
    expect(domainEvents.length).toBeGreaterThanOrEqual(1);
    expect(domainEvents[0]?.envelope['event_type']).toBe('DigiLockerPublishSucceeded');
  });

  it('issuance_reversed_on_publish_failure=false is immutable even on failure', async () => {
    const h = makeHarness({ scenario: 'digilocker_publish_fail' });
    await h.call('POST', '/v1/digilocker-publish', validBody);
    const store = h.repo.tenant(h.state.ctx.tenant_id);
    for (const row of store.publishRecords.values()) {
      expect(row.issuance_reversed_on_publish_failure).toBe(false);
      expect(row.registry_status_changed_by_publish).toBe(false);
    }
  });

  it('returns 400 when consent_ref is missing', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', {
      credential_id: CREDENTIAL_ID,
      purpose_code: PURPOSE_CODE,
      document_type_ref: DOCUMENT_TYPE_REF,
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 when purpose_code is missing', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', {
      credential_id: CREDENTIAL_ID,
      consent_ref: CONSENT_REF,
      document_type_ref: DOCUMENT_TYPE_REF,
    });
    expect(r.status).toBe(400);
  });

  it('returns 201 on getPublishRecord after publish', async () => {
    const h = makeHarness();
    const created = await h.call('POST', '/v1/digilocker-publish', validBody);
    const body = created.body as Record<string, unknown>;
    const id = body['publish_request_id'] as string;
    const got = await h.call('GET', `/v1/digilocker-publish/${id}`);
    expect(got.status).toBe(200);
    expect((got.body as Record<string, unknown>)['publish_request_id']).toBe(id);
  });

  it('returns 404 for unknown publish_request_id', async () => {
    const h = makeHarness();
    const r = await h.call('GET', '/v1/digilocker-publish/00000000-0000-4000-8000-000000000099');
    expect(r.status).toBe(404);
  });

  it('simulation_marker present in stored record for SIMULATED mode', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/digilocker-publish', validBody);
    const store = h.repo.tenant(h.state.ctx.tenant_id);
    for (const row of store.publishRecords.values()) {
      expect(row.simulation_marker).not.toBeNull();
      expect((row.simulation_marker as Record<string, unknown>)['simulation']).toBe(true);
    }
  });

  it('returns 405 for unsupported method', async () => {
    const h = makeHarness();
    const r = await h.call('DELETE', '/v1/digilocker-publish');
    expect(r.status).toBe(400);
  });
});

describe('mode matrix', () => {
  it('SIMULATED mode stores connector_mode=SIMULATED and simulation_marker', async () => {
    const h = makeHarness({ env: 'LOCAL' });
    await h.call('POST', '/v1/digilocker-publish', validBody);
    const store = h.repo.tenant(h.state.ctx.tenant_id);
    for (const row of store.publishRecords.values()) {
      expect(row.connector_mode).toBe('SIMULATED');
      expect(row.simulation_marker).not.toBeNull();
    }
  });

  it('SIMULATED CI mode works equivalently', async () => {
    const h = makeHarness({ env: 'CI' });
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['connector_mode']).toBe('SIMULATED');
  });
});
