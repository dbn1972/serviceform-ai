import { describe, expect, it } from 'vitest';
import {
  APP_1,
  APP_UNAPPROVED,
  APPROVAL_REF,
  conforms,
  ctxFor,
  ISSUER_REF,
  finding,
  must,
  T1,
} from './support/fixtures.js';
import {
  activate,
  credentialOf,
  issue,
  issueActiveWithQr,
  mintQr,
  publish,
  REG,
  registryStatus,
  verify,
} from './support/flow.js';
import { buildStack } from './support/wiring.js';

/**
 * INT-008 Approval → signing → credential → QR → DigiLocker (SF-M07-INT, independent).
 * Real CMP-022/024/023/012 services and handlers, owner in-memory repositories, stitcher-owned
 * seam adapters. eSign and DigiLocker are SIMULATED (INT-013). Not CERTIFIED.
 */
const AUDIT_TOPIC = 'sf.audit.ingest.v1';

describe('INT-008 approval → signing → credential → QR → DigiLocker', () => {
  it('runs the full chain end to end and every hop conforms to its FROZEN contract', async () => {
    const s = buildStack();
    const { credentialId, credential } = await issue(s);

    expect(credential).toMatchObject({
      lifecycle_status: 'ISSUED',
      application_id: APP_1,
      approval_decision_ref: APPROVAL_REF,
      approval_decision_by_this_component: false,
      registry_status_owner_cmp: 'CMP-024',
      issuance_reversible_by_publish_failure: false,
      issuance_reversible_by_notification_failure: false,
    });
    expect(conforms('m07/credential', credential).errors).toBe('');

    const signing = await s.call(
      'CMP-022',
      'GET',
      `/v1/credentials/${credentialId}/signing-records`,
    );
    expect(signing.status).toBe(200);
    const [record] = signing.body.signing_records as Array<Record<string, unknown>>;
    expect(record).toMatchObject({
      signing_result: 'SIGNED',
      connector_mode: 'SIMULATED',
      integration_contract: 'INT-013',
      simulation_marker: { simulation: true, environment: 'CI' },
    });
    expect(conforms('m07/signing-record', record).errors).toBe('');

    const registered = await registryStatus(s, T1, credentialId);
    expect(registered.status).toBe(200);
    expect(registered.body.credential_status).toMatchObject({
      credential_id: credentialId,
      issuer_ref: ISSUER_REF,
      status_authority_cmp: 'CMP-024',
      current_status: 'REGISTERED',
    });
    expect(conforms('m07/credential-status', registered.body.credential_status).errors).toBe('');

    await activate(s, T1, credentialId);
    const qr = await mintQr(s, T1, credentialId);
    expect(qr.status, JSON.stringify(qr.body)).toBe(201);
    expect(conforms('m07/verification-token', qr.body.token).errors).toBe('');
    expect(qr.body.token.public_view).toMatchObject({
      registry_status: 'ACTIVE',
      issuer_ref: ISSUER_REF,
    });

    const verified = await verify(s, T1, qr.body.token.opaque_token as string);
    expect(verified.status).toBe(200);
    expect(verified.body.public_view.registry_status).toBe('ACTIVE');
    const publicText = JSON.stringify(verified.body);
    for (const hidden of [credentialId, T1, APP_1, qr.body.token.token_id as string]) {
      expect(publicText).not.toContain(hidden);
    }

    const published = await publish(s, T1, credentialId);
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    expect(published.body).toMatchObject({
      credential_id: credentialId,
      publish_status: 'PUBLISHED',
      connector_mode: 'SIMULATED',
      issuance_reversed_on_publish_failure: false,
      registry_status_changed_by_publish: false,
    });

    const outcome = await s.call(
      'CMP-022',
      'POST',
      `/v1/credentials/${credentialId}/downstream-outcomes`,
      {
        channel: 'DIGILOCKER_PUBLISH',
        outcome: 'SUCCEEDED',
        outcome_ref: `dl:${published.body.publish_request_id as string}`,
      },
      { ctx: ctxFor(T1, 'SYSTEM') },
    );
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);
    expect((await credentialOf(s, T1, credentialId)).body.lifecycle_status).toBe('ISSUED');
  });

  it('emits CredentialGenerated → Signed → Issued and registry/QR/DigiLocker events as valid envelopes', async () => {
    const s = buildStack();
    const { credentialId } = await issueActiveWithQr(s);
    await publish(s, T1, credentialId);

    const domain = <E>(o: Array<{ topic: string; envelope: E }>): E[] =>
      o.filter((x) => x.topic !== AUDIT_TOPIC).map((x) => x.envelope);
    const audits = [
      ...s.repos.credential.tenant(T1).outbox,
      ...s.repos.registry.tenant(T1).outbox,
      ...s.repos.qr.tenant(T1).outbox,
    ].filter((o) => o.topic === AUDIT_TOPIC);
    expect(audits.length).toBe(6);
    const credEvents = domain(s.repos.credential.tenant(T1).outbox);
    expect(credEvents.map((e) => e.event_type)).toEqual([
      'CredentialGenerated',
      'CredentialSigned',
      'CredentialIssued',
    ]);
    const regEvents = domain(s.repos.registry.tenant(T1).outbox);
    expect(regEvents.map((e) => e.event_type)).toEqual([
      'CredentialRegistered',
      'CredentialStatusChanged',
    ]);
    const qrEvents = domain(s.repos.qr.tenant(T1).outbox);
    expect(qrEvents.map((e) => e.event_type)).toEqual(['VerificationTokenIssued']);
    const dlEvents = domain(s.repos.digilocker.tenant(T1).outbox);
    expect(dlEvents.map((e) => e.event_type)).toEqual(['DigiLockerPublishSucceeded']);

    for (const env of [
      ...credEvents,
      ...regEvents,
      ...qrEvents,
      ...dlEvents,
      ...audits.map((a) => a.envelope),
    ]) {
      expect(conforms('event-envelope', env).errors).toBe('');
      expect(env.tenant_id).toBe(T1);
    }
  });

  it('never calls a cross-component port while any component transaction is open', async () => {
    const s = buildStack();
    let violations = 0;
    const probe = <T extends object>(target: T, method: keyof T): void => {
      const original = (target[method] as (...a: unknown[]) => unknown).bind(target);
      (target as Record<keyof T, unknown>)[method] = (...args: unknown[]) => {
        if (s.anyTxOpen()) violations += 1;
        return original(...args);
      };
    };
    probe(s.signer, 'sign');
    probe(s.registryBridge, 'register');
    probe(s.credentialRead, 'getCredential');
    probe(s.statusRead, 'getStatus');
    probe(s.digilockerApi, 'publish');
    const { credentialId, opaque } = await issueActiveWithQr(s);
    await verify(s, T1, opaque);
    await publish(s, T1, credentialId);
    expect(s.signer.calls.length).toBe(1);
    expect(s.digilockerApi.calls.length).toBe(1);
    expect(violations).toBe(0);
  });

  it('refuses issuance without a recorded upstream approval and nothing downstream is created', async () => {
    const s = buildStack();
    s.casePins.approve(T1, APP_UNAPPROVED, false);
    const res = await s.call(
      'CMP-022',
      'POST',
      '/v1/credentials',
      { application_id: APP_UNAPPROVED, issuance_key: 'issue:unapproved:1' },
      { ctx: ctxFor(T1, 'SYSTEM') },
    );
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('SF-WF-001');
    expect(conforms('error-response', res.body).errors).toBe('');
    expect(s.signer.calls.length).toBe(0);
    expect(s.registryBridge.calls).toBe(0);
    expect(s.repos.registry.tenant(T1).entries.size).toBe(0);
  });

  it('refuses client-supplied approval/status/pins (LLM/client cannot decide approval)', async () => {
    const s = buildStack();
    s.casePins.approve(T1, APP_UNAPPROVED, false);
    for (const forged of [
      { approval_decision_ref: APPROVAL_REF },
      { approved: true },
      { lifecycle_status: 'ISSUED' },
      { current_status: 'ACTIVE' },
      { credential_template_id: APP_1 },
    ]) {
      const res = await s.call(
        'CMP-022',
        'POST',
        '/v1/credentials',
        { application_id: APP_UNAPPROVED, issuance_key: 'issue:forged:1', ...forged },
        { ctx: ctxFor(T1, 'SYSTEM') },
      );
      expect(res.status, JSON.stringify(forged)).toBe(400);
      expect(res.body.error_code).toBe('SF-SYS-003');
    }
    expect(s.repos.credential.tenant(T1).credentials.size).toBe(0);
  });

  it('refuses citizen-initiated issuance (SF-AUTH-002)', async () => {
    const s = buildStack();
    s.casePins.approve(T1, APP_1);
    const res = await s.call(
      'CMP-022',
      'POST',
      '/v1/credentials',
      { application_id: APP_1, issuance_key: 'issue:citizen:1' },
      { ctx: ctxFor(T1, 'CITIZEN') },
    );
    expect(res.status).toBe(403);
    expect(res.body.error_code).toBe('SF-AUTH-002');
    expect(s.repos.credential.tenant(T1).credentials.size).toBe(0);
  });

  it('a FAILED eSign leaves the credential GENERATED, unregistered and not QR-mintable', async () => {
    const s = buildStack();
    s.casePins.approve(T1, APP_1);
    s.signer.outcome = 'FAILED';
    const res = await s.call(
      'CMP-022',
      'POST',
      '/v1/credentials',
      { application_id: APP_1, issuance_key: 'issue:fail:1' },
      { ctx: ctxFor(T1, 'SYSTEM') },
    );
    expect(res.body.error_code).toBe('SF-CRED-001');
    const [row] = [...s.repos.credential.tenant(T1).credentials.values()];
    expect(must(row).lifecycle_status).toBe('GENERATED');
    expect(s.registryBridge.calls).toBe(0);

    const qr = await mintQr(s, T1, must(row).credential_id);
    expect(qr.status).toBeGreaterThanOrEqual(400);
    expect(s.repos.qr.tenant(T1).tokens.size).toBe(0);

    s.signer.outcome = 'SIGNED';
    const retry = await s.call(
      'CMP-022',
      'POST',
      '/v1/credentials',
      { application_id: APP_1, issuance_key: 'issue:fail:1' },
      { ctx: ctxFor(T1, 'SYSTEM') },
    );
    expect(retry.status).toBe(201);
    expect(retry.body.credential_id).toBe(must(row).credential_id);
    const records = await s.call(
      'CMP-022',
      'GET',
      `/v1/credentials/${must(row).credential_id}/signing-records`,
    );
    expect((records.body.signing_records as unknown[]).length).toBe(2);
  });

  it('a CMP-024 outage leaves the credential SIGNED (not ISSUED); retry resumes with one registry entry', async () => {
    const s = buildStack();
    s.casePins.approve(T1, APP_1);
    s.registryBridge.down = true;
    const body = { application_id: APP_1, issuance_key: 'issue:regdown:1' };
    const first = await s.call('CMP-022', 'POST', '/v1/credentials', body, {
      ctx: ctxFor(T1, 'SYSTEM'),
    });
    expect(first.body.error_code).toBe('SF-INT-001');
    const [row] = [...s.repos.credential.tenant(T1).credentials.values()];
    expect(must(row).lifecycle_status).toBe('SIGNED');
    expect(s.repos.registry.tenant(T1).entries.size).toBe(0);

    s.registryBridge.down = false;
    const retry = await s.call('CMP-022', 'POST', '/v1/credentials', body, {
      ctx: ctxFor(T1, 'SYSTEM'),
    });
    expect(retry.status).toBe(201);
    expect(retry.body.lifecycle_status).toBe('ISSUED');
    expect(s.signer.calls.length).toBe(1);
    expect(s.repos.registry.tenant(T1).entries.size).toBe(1);

    const again = await s.call('CMP-022', 'POST', '/v1/credentials', body, {
      ctx: ctxFor(T1, 'SYSTEM'),
    });
    expect(again.status).toBe(200);
    expect(again.body.credential_id).toBe(retry.body.credential_id);
    expect(s.repos.registry.tenant(T1).entries.size).toBe(1);
    expect(s.repos.credential.tenant(T1).credentials.size).toBe(1);
  });

  it('replays an identical Idempotency-Key without re-signing or re-registering', async () => {
    const s = buildStack();
    s.casePins.approve(T1, APP_1);
    const body = { application_id: APP_1, issuance_key: 'issue:replay:1' };
    const ctx = ctxFor(T1, 'SYSTEM');
    const a = await s.call('CMP-022', 'POST', '/v1/credentials', body, {
      ctx,
      key: 'idem-replay-0001',
    });
    const b = await s.call('CMP-022', 'POST', '/v1/credentials', body, {
      ctx,
      key: 'idem-replay-0001',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(s.signer.calls.length).toBe(1);
    expect(s.registryBridge.calls).toBe(1);

    const conflict = await s.call(
      'CMP-022',
      'POST',
      '/v1/credentials',
      { ...body, issuance_key: 'issue:replay:2' },
      { ctx, key: 'idem-replay-0001' },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error_code).toBe('SF-APP-002');
  });

  it('QR verification reads status live from CMP-024: suspend/revoke is reflected immediately', async () => {
    const s = buildStack();
    const { credentialId, opaque } = await issueActiveWithQr(s);
    expect((await verify(s, T1, opaque)).body.public_view.registry_status).toBe('ACTIVE');

    const suspend = await s.call(
      'CMP-024',
      'POST',
      `${REG}/${credentialId}/suspend`,
      { expected_version: 2, reason_code_ref: 'reason:tenant-meta:susp' },
      { ctx: ctxFor(T1, 'OFFICER') },
    );
    expect(suspend.status, JSON.stringify(suspend.body)).toBe(200);
    expect((await verify(s, T1, opaque)).body.public_view.registry_status).toBe('SUSPENDED');

    const revoke = await s.call(
      'CMP-024',
      'POST',
      `${REG}/${credentialId}/revoke`,
      { expected_version: 3, reason_code_ref: 'reason:tenant-meta:revk' },
      { ctx: ctxFor(T1, 'OFFICER') },
    );
    expect(revoke.status).toBe(200);
    expect((await verify(s, T1, opaque)).body.public_view.registry_status).toBe('REVOKED');
    expect((await credentialOf(s, T1, credentialId)).body.lifecycle_status).toBe('ISSUED');
  });

  it('QR verify fails closed (no cached status) when CMP-024 is unavailable', async () => {
    const s = buildStack();
    const { opaque } = await issueActiveWithQr(s);
    s.statusRead.down = true;
    const res = await verify(s, T1, opaque);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.error_code).toBe('SF-INT-001');
    expect(JSON.stringify(res.body)).not.toContain('ACTIVE');
  });

  it('QR mint refuses client attempts to supply registry status', async () => {
    const s = buildStack();
    const { credentialId } = await issue(s);
    const res = await s.call(
      'CMP-023',
      'POST',
      '/v1/qr/tokens',
      { credential_id: credentialId, credential_type_ref: 'credtype:x', registry_status: 'ACTIVE' },
      { ctx: ctxFor(T1, 'SYSTEM') },
    );
    expect(res.status).toBe(400);
    expect(s.repos.qr.tenant(T1).tokens.size).toBe(0);
  });

  it('FINDING M07-INT-F02 (characterised): officer-initiated issuance cannot register at CMP-024 through a context-preserving bridge', async () => {
    // CMP-022 ISSUE_ACTORS = SYSTEM|OFFICER; CMP-024 REGISTER_ACTORS = SYSTEM only. With the
    // issuing context passed through unchanged, an OFFICER issuance stalls at SIGNED.
    const s = buildStack();
    s.casePins.approve(T1, APP_1);
    const res = await s.call(
      'CMP-022',
      'POST',
      '/v1/credentials',
      { application_id: APP_1, issuance_key: 'issue:officer:1' },
      { ctx: ctxFor(T1, 'OFFICER') },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const [row] = [...s.repos.credential.tenant(T1).credentials.values()];
    expect(must(row).lifecycle_status).toBe('SIGNED');
    expect(s.repos.registry.tenant(T1).entries.size).toBe(0);
  });

  finding(
    'FINDING M07-INT-F01: CMP-012 must refuse to publish a credential that CMP-022 never issued (SF-CON-DIGILOCKER-PUBLISH: only ISSUED)',
    async () => {
      const s = buildStack();
      const neverIssued = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
      expect((await credentialOf(s, T1, neverIssued)).status).toBe(404);
      const res = await publish(s, T1, neverIssued);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(s.repos.digilocker.tenant(T1).publishRecords.size).toBe(0);
    },
  );

  finding(
    'FINDING M07-INT-F01b: CMP-012 must refuse to publish a GENERATED (unsigned) credential',
    async () => {
      const s = buildStack();
      s.casePins.approve(T1, APP_1);
      s.signer.outcome = 'FAILED';
      await s.call(
        'CMP-022',
        'POST',
        '/v1/credentials',
        { application_id: APP_1, issuance_key: 'issue:gen:1' },
        { ctx: ctxFor(T1, 'SYSTEM') },
      );
      const [row] = [...s.repos.credential.tenant(T1).credentials.values()];
      expect(must(row).lifecycle_status).toBe('GENERATED');
      const res = await publish(s, T1, must(row).credential_id);
      expect(res.status).toBeGreaterThanOrEqual(400);
    },
  );

  finding(
    'FINDING M07-INT-F03: CMP-012 publish response/record is not projectable to FROZEN SF-CON-DIGILOCKER-PUBLISH',
    async () => {
      const s = buildStack();
      const { credentialId } = await issue(s);
      const created = await publish(s, T1, credentialId);
      const read = await s.call(
        'CMP-012',
        'GET',
        `/v1/digilocker-publish/${created.body.publish_request_id as string}`,
      );
      expect(read.status).toBe(200);
      expect(conforms('m07/digilocker-publish', read.body).errors).toBe('');
    },
  );

  finding(
    'FINDING M07-INT-F04: CMP-012 audit envelopes use event_type AuditEvent with envelope tenant_id null; CMP-022/023/024 (and every other component) emit tenant-scoped AuditEventSubmitted',
    async () => {
      const s = buildStack();
      const { credentialId } = await issueActiveWithQr(s);
      await publish(s, T1, credentialId);
      const types = (cmpOutbox: Array<{ topic: string; envelope: { event_type: string } }>) =>
        new Set(cmpOutbox.filter((o) => o.topic === AUDIT_TOPIC).map((o) => o.envelope.event_type));
      expect([...types(s.repos.credential.tenant(T1).outbox)]).toEqual(['AuditEventSubmitted']);
      expect([...types(s.repos.registry.tenant(T1).outbox)]).toEqual(['AuditEventSubmitted']);
      expect([...types(s.repos.qr.tenant(T1).outbox)]).toEqual(['AuditEventSubmitted']);
      const dlAudit = s.repos.digilocker
        .tenant(T1)
        .outbox.filter((o) => o.topic === AUDIT_TOPIC)
        .map((o) => o.envelope as { event_type: string; tenant_id: string | null });
      expect(dlAudit.length).toBe(1);
      expect(dlAudit.map((e) => e.event_type)).toEqual(['AuditEventSubmitted']);
      expect(dlAudit.map((e) => e.tenant_id)).toEqual([T1]);
    },
  );
});
