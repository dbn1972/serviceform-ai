import { describe, expect, it } from 'vitest';
import { ctxFor, T1 } from './support/fixtures.js';
import {
  credentialOf,
  issueActiveWithQr,
  publish,
  registryStatus,
  verify,
} from './support/flow.js';
import { buildStack, simulatedDigiLocker, type Stack } from './support/wiring.js';

/**
 * INT-008 invariant: issuance is not reversed by DigiLocker publish or notification failure.
 * SF-CON-CREDENTIAL issuance_reversible_by_* and SF-CON-DIGILOCKER-PUBLISH
 * issuance_reversed_on_publish_failure / registry_status_changed_by_publish are const false.
 */

async function assertIssuanceIntact(s: Stack, credentialId: string, opaque: string): Promise<void> {
  const cred = await credentialOf(s, T1, credentialId);
  expect(cred.status).toBe(200);
  expect(cred.body.lifecycle_status).toBe('ISSUED');
  const reg = await registryStatus(s, T1, credentialId);
  expect(reg.body.credential_status.current_status).toBe('ACTIVE');
  expect(reg.body.status_version).toBe(2);
  expect((await verify(s, T1, opaque)).body.public_view.registry_status).toBe('ACTIVE');

  const credTypes = s.repos.credential.tenant(T1).outbox.map((o) => o.envelope.event_type);
  expect(credTypes.filter((t) => /Revok|Revers|Compensat|Cancel/i.test(t))).toEqual([]);
  const regTypes = s.repos.registry.tenant(T1).outbox.map((o) => o.envelope.event_type);
  expect(regTypes.filter((t) => t === 'CredentialStatusChanged').length).toBe(1);
}

async function recordOutcome(
  s: Stack,
  credentialId: string,
  channel: 'DIGILOCKER_PUBLISH' | 'NOTIFICATION',
  ref: string,
) {
  return s.call(
    'CMP-022',
    'POST',
    `/v1/credentials/${credentialId}/downstream-outcomes`,
    { channel, outcome: 'FAILED', outcome_ref: ref, failure_code: 'SF-INT-001' },
    { ctx: ctxFor(T1, 'SYSTEM') },
  );
}

describe('INT-008 issuance not reversed by DigiLocker / notification outage', () => {
  it('a FAILED DigiLocker publish (provider-side failure scenario) leaves issuance and registry untouched', async () => {
    const s = buildStack({ digilockerApi: simulatedDigiLocker('CI', 'digilocker_publish_fail') });
    const { credentialId, opaque } = await issueActiveWithQr(s);
    const res = await publish(s, T1, credentialId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      publish_status: 'FAILED',
      failure_code: 'SF-INT-001',
      issuance_reversed_on_publish_failure: false,
      registry_status_changed_by_publish: false,
    });
    const outcome = await recordOutcome(s, credentialId, 'DIGILOCKER_PUBLISH', 'dl:fail-scenario');
    expect(outcome.status).toBe(201);
    await assertIssuanceIntact(s, credentialId, opaque);
    expect(s.repos.digilocker.tenant(T1).outbox.map((o) => o.envelope['event_type'])).toContain(
      'DigiLockerPublishFailed',
    );
  });

  it('a DigiLocker transport outage (adapter throws) records FAILED and does not reverse issuance', async () => {
    const s = buildStack();
    const { credentialId, opaque } = await issueActiveWithQr(s);
    s.digilockerApi.outage = true;
    const res = await publish(s, T1, credentialId);
    expect(res.status).toBe(201);
    expect(res.body.publish_status).toBe('FAILED');
    expect(res.body.issuance_reversed_on_publish_failure).toBe(false);
    await assertIssuanceIntact(s, credentialId, opaque);

    s.digilockerApi.outage = false;
    const retry = await publish(s, T1, credentialId);
    expect(retry.body.publish_status).toBe('PUBLISHED');
    await assertIssuanceIntact(s, credentialId, opaque);
  });

  it('a connector-binding registry outage refuses publish fail-closed (SF-SYS-004) without touching issuance', async () => {
    const s = buildStack();
    const { credentialId, opaque } = await issueActiveWithQr(s);
    s.bindings.down = true;
    const res = await publish(s, T1, credentialId);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.error_code).toBe('SF-SYS-004');
    expect(s.digilockerApi.calls.length).toBe(0);
    expect(s.repos.digilocker.tenant(T1).publishRecords.size).toBe(0);
    await assertIssuanceIntact(s, credentialId, opaque);
  });

  it('a notification outage recorded as a FAILED downstream outcome leaves the credential ISSUED', async () => {
    const s = buildStack();
    const { credentialId, opaque } = await issueActiveWithQr(s);
    const res = await recordOutcome(s, credentialId, 'NOTIFICATION', 'notify:dispatch-outage-1');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ channel: 'NOTIFICATION', outcome: 'FAILED' });
    const replay = await recordOutcome(s, credentialId, 'NOTIFICATION', 'notify:dispatch-outage-1');
    expect([200, 201]).toContain(replay.status);
    expect(s.repos.credential.tenant(T1).outcomes.length).toBe(1);
    await assertIssuanceIntact(s, credentialId, opaque);
  });

  it('CredentialIssued declares non-reversibility and registry ownership in its payload', async () => {
    const s = buildStack();
    await issueActiveWithQr(s);
    const issued = s.repos.credential
      .tenant(T1)
      .outbox.map((o) => o.envelope)
      .find((e) => e.event_type === 'CredentialIssued');
    expect(issued?.data).toMatchObject({
      issuance_reversible_by_publish_failure: false,
      issuance_reversible_by_notification_failure: false,
      registry_status_owner_cmp: 'CMP-024',
      approval_decision_by_this_component: false,
    });
  });

  it('downstream outcomes cannot be recorded by an OFFICER or CITIZEN (workload-only side channel)', async () => {
    const s = buildStack();
    const { credentialId } = await issueActiveWithQr(s);
    for (const actor of ['OFFICER', 'CITIZEN'] as const) {
      const res = await s.call(
        'CMP-022',
        'POST',
        `/v1/credentials/${credentialId}/downstream-outcomes`,
        {
          channel: 'NOTIFICATION',
          outcome: 'FAILED',
          outcome_ref: 'n:1',
          failure_code: 'SF-INT-001',
        },
        { ctx: ctxFor(T1, actor) },
      );
      expect(res.status, actor).toBe(403);
    }
    expect(s.repos.credential.tenant(T1).outcomes.length).toBe(0);
  });
});
