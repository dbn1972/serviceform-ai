import { describe, expect, it } from 'vitest';
import { createCredentialApi } from '../../src/api/handler.js';
import { credentialIdFor } from '../../src/domain/credential.js';
import { buildCredentialService } from '../../src/index.js';
import { CLIENT_AUTHORITY_KEYS } from '../../src/service/input.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ACTOR_CITIZEN,
  APPLICATION_ID,
  APPLICATION_NO_TEMPLATE,
  APPLICATION_UNAPPROVED,
  APPROVAL_REF,
  BINDING_ID,
  ctxFor,
  ISSUANCE_KEY,
  SERVICE_VERSION_ID,
  simulatedFailed,
  simulatedSigned,
  TEMPLATE_ID,
  TENANT_A,
  TSB_ID,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const CREDENTIALS = '/v1/credentials';
const ISSUE = { application_id: APPLICATION_ID, issuance_key: ISSUANCE_KEY };
const CREDENTIAL_ID = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);

function errCode(body: unknown): string | undefined {
  return (body as Body)['details']?.[0]?.code as string | undefined;
}

function domainEvents(h: Harness): string[] {
  return h.repo
    .tenant(TENANT_A)
    .outbox.filter((o) => o.topic === TOPIC_DOMAIN)
    .map((o) => o.envelope.event_type);
}

function stored(h: Harness): Body | undefined {
  return h.repo.tenant(TENANT_A).credentials.get(CREDENTIAL_ID) as Body | undefined;
}

describe('POST /v1/credentials: GENERATED -> SIGNED -> ISSUED', () => {
  it('issues from case pins, records artifact hash refs and the signing attempt', async () => {
    const h = makeHarness();
    const res = await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0001' });
    expect(res.status).toBe(201);
    const c = res.body as Body;
    expect(c).toMatchObject({
      contract_id: 'SF-CON-CREDENTIAL',
      tenant_id: TENANT_A,
      credential_id: CREDENTIAL_ID,
      application_id: APPLICATION_ID,
      version_pins: { tenant_service_binding_id: TSB_ID, service_version_id: SERVICE_VERSION_ID },
      template_pin: { credential_template_id: TEMPLATE_ID, credential_template_version: 3 },
      lifecycle_status: 'ISSUED',
      issuance_key: ISSUANCE_KEY,
      idempotency_key: 'issue-key-0001',
      approval_decision_ref: APPROVAL_REF,
      approval_decision_by_this_component: false,
      registry_status_owner_cmp: 'CMP-024',
      issued_at: '2026-10-14T04:00:00.000Z',
      issuance_reversible_by_publish_failure: false,
      issuance_reversible_by_notification_failure: false,
      invented_statutory_policy_forbidden: true,
    });
    expect((c['artifacts'] as Body[]).map((a) => a['artifact_kind'])).toEqual([
      'UNSIGNED_RENDER',
      'SIGNED_ARTIFACT',
    ]);
    for (const a of c['artifacts'] as Body[]) {
      expect(Object.keys(a).sort()).toEqual(['artifact_kind', 'sha256', 'storage_key']);
    }
    const signing = h.repo.tenant(TENANT_A).signing;
    expect(signing).toHaveLength(1);
    expect(c['signing_record_id']).toBe(signing[0]?.signing_record_id);
    expect(signing[0]).toMatchObject({
      attempt_number: 1,
      idempotency_key: `cmp022.sign.${CREDENTIAL_ID}.1`,
      connector_mode: 'SIMULATED',
      signing_result: 'SIGNED',
      connector_binding_id: BINDING_ID,
    });
    expect(h.renderer.calls).toHaveLength(1);
    expect(h.renderer.calls[0]).toMatchObject({
      credential_template_id: TEMPLATE_ID,
      credential_template_version: 3,
      idempotency_key: `cmp022.render.${CREDENTIAL_ID}`,
    });
    expect(h.signer.calls[0]?.artifact.sha256).toBe((c['artifacts'] as Body[])[0]?.['sha256']);
    expect(h.registry.calls).toEqual([
      {
        credential_id: CREDENTIAL_ID,
        application_id: APPLICATION_ID,
        signed_artifact_sha256: (c['artifacts'] as Body[])[1]?.['sha256'],
        idempotency_key: `cmp022.register.${CREDENTIAL_ID}`,
      },
    ]);
    expect(domainEvents(h)).toEqual([
      'CredentialGenerated',
      'CredentialSigned',
      'CredentialIssued',
    ]);
    const audits = h.repo.tenant(TENANT_A).outbox.filter((o) => o.topic === TOPIC_AUDIT);
    expect(audits.map((a) => (a.envelope.data as Body)['action'])).toEqual([
      'CREDENTIAL_GENERATE',
      'CREDENTIAL_SIGN',
      'CREDENTIAL_ISSUE',
    ]);
    expect(h.probe.violations).toBe(0);
  });

  it('a REAL connector in PRODUCTION issues without a simulation marker', async () => {
    const h = makeHarness({ environment: 'PRODUCTION' });
    h.signer.fallback = (req) => {
      const { simulation_marker: _m, ...rest } = simulatedSigned(req);
      return { ...rest, connector_mode: 'REAL' };
    };
    const res = await h.call('POST', CREDENTIALS, ISSUE);
    expect(res.status).toBe(201);
    expect(h.repo.tenant(TENANT_A).signing[0]?.simulation_marker).toBeNull();
  });

  it('replays the same Idempotency-Key with the stored response and no port calls', async () => {
    const h = makeHarness();
    const first = await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0002' });
    const again = await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0002' });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(h.renderer.calls).toHaveLength(1);
    expect(h.signer.calls).toHaveLength(1);
    expect(h.registry.calls).toHaveLength(1);
    expect(h.casePins.calls).toBe(1);
  });

  it('a new Idempotency-Key for an issued issuance_key returns the same credential (200)', async () => {
    const h = makeHarness();
    const first = await h.call('POST', CREDENTIALS, ISSUE);
    const second = await h.call('POST', CREDENTIALS, ISSUE);
    expect(second.status).toBe(200);
    expect((second.body as Body)['credential_id']).toBe((first.body as Body)['credential_id']);
    expect((second.body as Body)['idempotency_key']).toBe((first.body as Body)['idempotency_key']);
    expect(h.renderer.calls).toHaveLength(1);
    expect(h.signer.calls).toHaveLength(1);
    expect(h.repo.tenant(TENANT_A).credentials.size).toBe(1);
    expect(domainEvents(h)).toHaveLength(3);
  });

  it('a different issuance_key yields a distinct credential for the same application', async () => {
    const h = makeHarness();
    await h.call('POST', CREDENTIALS, ISSUE);
    const other = await h.call('POST', CREDENTIALS, { ...ISSUE, issuance_key: 'app-3333:issue:2' });
    expect(other.status).toBe(201);
    expect((other.body as Body)['credential_id']).not.toBe(CREDENTIAL_ID);
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/credentials`, undefined, {
      key: null,
    });
    expect(((list.body as Body)['credentials'] as unknown[]).length).toBe(2);
  });

  it('the same Idempotency-Key with a different body is a conflict', async () => {
    const h = makeHarness();
    await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0003' });
    const res = await h.call(
      'POST',
      CREDENTIALS,
      { ...ISSUE, issuance_key: 'app-3333:issue:9' },
      { key: 'issue-key-0003' },
    );
    expect(res.status).toBe(409);
    expect((res.body as Body)['error_code']).toBe('SF-APP-002');
  });
});

describe('approval is referenced, never decided', () => {
  it('refuses issuance when the upstream approval is not recorded; nothing is rendered', async () => {
    const h = makeHarness();
    const res = await h.call('POST', CREDENTIALS, {
      ...ISSUE,
      application_id: APPLICATION_UNAPPROVED,
    });
    expect(res.status).toBe(409);
    expect((res.body as Body)['error_code']).toBe('SF-WF-001');
    expect(errCode(res.body)).toBe('UPSTREAM_APPROVAL_NOT_RECORDED');
    expect(h.renderer.calls).toHaveLength(0);
    expect(h.repo.tenant(TENANT_A).credentials.size).toBe(0);
  });

  it('refuses a malformed upstream approval reference', async () => {
    const h = makeHarness();
    h.casePins.set(TENANT_A, {
      application_id: APPLICATION_ID,
      tenant_service_binding_id: TSB_ID,
      service_version_id: SERVICE_VERSION_ID,
      credential_template_id: TEMPLATE_ID,
      credential_template_version: 3,
      approval_decision_ref: 'has spaces',
    });
    const res = await h.call('POST', CREDENTIALS, ISSUE);
    expect(errCode(res.body)).toBe('UPSTREAM_APPROVAL_REF_INVALID');
  });

  it.each([...CLIENT_AUTHORITY_KEYS])('client cannot supply %s', async (key) => {
    const h = makeHarness();
    const res = await h.call('POST', CREDENTIALS, { ...ISSUE, [key]: 'x' });
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('CLIENT_AUTHORITY_FORBIDDEN');
    expect(h.casePins.calls).toBe(0);
  });

  it.each(['issued_at', 'signed_at', 'now'])('client time %s is not authoritative', async (key) => {
    const h = makeHarness();
    const res = await h.call('POST', CREDENTIALS, { ...ISSUE, [key]: '2026-01-01T00:00:00Z' });
    expect(errCode(res.body)).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');
  });

  it('refuses an application with no pinned credential template', async () => {
    const h = makeHarness();
    const res = await h.call('POST', CREDENTIALS, {
      ...ISSUE,
      application_id: APPLICATION_NO_TEMPLATE,
    });
    expect(res.status).toBe(409);
    expect(errCode(res.body)).toBe('CREDENTIAL_TEMPLATE_NOT_PINNED');
  });

  it('refuses invalid case pins', async () => {
    const h = makeHarness();
    h.casePins.set(TENANT_A, {
      application_id: APPLICATION_ID,
      tenant_service_binding_id: 'nope',
      service_version_id: SERVICE_VERSION_ID,
      credential_template_id: TEMPLATE_ID,
      credential_template_version: 0,
      approval_decision_ref: APPROVAL_REF,
    });
    expect(errCode((await h.call('POST', CREDENTIALS, ISSUE)).body)).toBe('CASE_PINS_INVALID');
  });

  it('an invisible application is not found; a port failure fails closed', async () => {
    const h = makeHarness();
    const missing = await h.call('POST', CREDENTIALS, {
      ...ISSUE,
      application_id: '33333333-3333-4333-8333-3333333333ff',
    });
    expect(missing.status).toBe(404);
    h.casePins.failure = new Error('case service down');
    const down = await h.call('POST', CREDENTIALS, ISSUE);
    expect(down.status).toBe(503);
    expect(errCode(down.body)).toBe('CASE_PINS_UNAVAILABLE');
  });
});

describe('request validation and access', () => {
  it.each([
    [{ application_id: 'nope', issuance_key: ISSUANCE_KEY }, 'UUID_REQUIRED'],
    [{ application_id: APPLICATION_ID, issuance_key: 'short' }, 'ISSUANCE_KEY_INVALID'],
    [{ application_id: APPLICATION_ID, issuance_key: 'has space here' }, 'ISSUANCE_KEY_INVALID'],
    [{ ...ISSUE, extra: 1 }, 'UNKNOWN_FIELD'],
    [[1], 'BODY_OBJECT_REQUIRED'],
  ])('rejects %j with %s', async (body, code) => {
    const h = makeHarness();
    const res = await h.call('POST', CREDENTIALS, body);
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe(code);
  });

  it('requires an Idempotency-Key on mutations', async () => {
    const h = makeHarness();
    const res = await h.call('POST', CREDENTIALS, ISSUE, { key: null });
    expect(errCode(res.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it.each(['CITIZEN', 'INTEGRATION'] as const)('%s actors cannot trigger issuance', async (t) => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, t);
    const res = await h.call('POST', CREDENTIALS, ISSUE);
    expect(res.status).toBe(403);
    expect(errCode(res.body)).toBe('ACTOR_NOT_PERMITTED');
  });

  it('OPA deny is 403 and PDP outage fails closed with 503', async () => {
    const h = makeHarness();
    h.authorizer.mode = 'deny';
    expect((await h.call('POST', CREDENTIALS, ISSUE)).status).toBe(403);
    h.authorizer.mode = 'throw';
    const res = await h.call('POST', CREDENTIALS, ISSUE);
    expect(res.status).toBe(503);
    expect(errCode(res.body)).toBe('PDP_UNAVAILABLE');
    expect(h.casePins.calls).toBe(0);
  });

  it('sends a tenant-scoped Credential resource to OPA with the application id', async () => {
    const h = makeHarness();
    await h.call('POST', CREDENTIALS, ISSUE);
    expect(h.authorizer.calls[0]).toMatchObject({
      action: 'CREDENTIAL_ISSUE',
      subject: { tenant_id: TENANT_A },
      resource: {
        resource_type: 'Credential',
        tenant_id: TENANT_A,
        application_id: APPLICATION_ID,
      },
    });
  });

  it('unknown routes are 404 and wrong methods are 400', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/v1/nope', undefined, { key: null })).status).toBe(404);
    const res = await h.call('DELETE', `${CREDENTIALS}/${CREDENTIAL_ID}`, undefined, { key: null });
    expect(errCode(res.body)).toBe('METHOD_NOT_ALLOWED');
  });

  it('GET routes validate path ids and refuse bodies', async () => {
    const h = makeHarness();
    const bad = await h.call('GET', `${CREDENTIALS}/not-a-uuid`, undefined, { key: null });
    expect(errCode(bad.body)).toBe('UUID_REQUIRED');
    const body = await h.call('GET', `${CREDENTIALS}/${CREDENTIAL_ID}`, { a: 1 }, { key: null });
    expect(errCode(body.body)).toBe('UNKNOWN_FIELD');
    const q = await h.call('GET', `${CREDENTIALS}/${CREDENTIAL_ID}`, undefined, {
      key: null,
      query: { as_of: 'x' },
    });
    expect(errCode(q.body)).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');
  });
});

describe('render and signing failures are retry-safe and never fabricate a signature', () => {
  it('render outage persists nothing; an invalid render ref is refused', async () => {
    const h = makeHarness();
    h.renderer.failure = new Error('storage down');
    const down = await h.call('POST', CREDENTIALS, ISSUE);
    expect(down.status).toBe(503);
    expect((down.body as Body)['error_code']).toBe('SF-CRED-001');
    expect(errCode(down.body)).toBe('RENDER_UNAVAILABLE');
    expect(stored(h)).toBeUndefined();
    h.renderer.failure = null;
    h.renderer.override = { sha256: 'not-a-hash' };
    expect(errCode((await h.call('POST', CREDENTIALS, ISSUE)).body)).toBe('RENDER_RESULT_INVALID');
    h.renderer.override = { storage_key: 'bad key with spaces' };
    expect(errCode((await h.call('POST', CREDENTIALS, ISSUE)).body)).toBe('RENDER_RESULT_INVALID');
    expect(stored(h)).toBeUndefined();
  });

  it('a FAILED attempt is recorded, leaves GENERATED, and a retry uses the next attempt key', async () => {
    const h = makeHarness();
    h.signer.script = [simulatedFailed];
    const failed = await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0004' });
    expect(failed.status).toBe(503);
    expect(errCode(failed.body)).toBe('SIGNING_FAILED');
    expect(stored(h)?.['lifecycle_status']).toBe('GENERATED');
    expect(h.repo.tenant(TENANT_A).signing.map((r) => r.signing_result)).toEqual(['FAILED']);
    expect(domainEvents(h)).toEqual(['CredentialGenerated', 'CredentialSigningFailed']);
    expect(h.registry.calls).toHaveLength(0);

    const retried = await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0004' });
    expect(retried.status).toBe(201);
    expect((retried.body as Body)['lifecycle_status']).toBe('ISSUED');
    expect(h.signer.calls.map((c) => c.idempotency_key)).toEqual([
      `cmp022.sign.${CREDENTIAL_ID}.1`,
      `cmp022.sign.${CREDENTIAL_ID}.2`,
    ]);
    expect(h.renderer.calls).toHaveLength(1);
    expect(h.casePins.calls).toBe(1);
    const signing = h.repo.tenant(TENANT_A).signing;
    expect((retried.body as Body)['signing_record_id']).toBe(signing[1]?.signing_record_id);
  });

  it('a signer transport error records no attempt; the retry reuses attempt 1 key', async () => {
    const h = makeHarness();
    h.signer.script = [() => new Error('connector timeout')];
    const res = await h.call('POST', CREDENTIALS, ISSUE);
    expect(res.status).toBe(503);
    expect(errCode(res.body)).toBe('SIGNING_UNAVAILABLE');
    expect(h.repo.tenant(TENANT_A).signing).toHaveLength(0);
    await h.call('POST', CREDENTIALS, ISSUE);
    expect(h.signer.calls.map((c) => c.attempt_number)).toEqual([1, 1]);
    expect(stored(h)?.['lifecycle_status']).toBe('ISSUED');
  });

  it.each(['PRODUCTION', 'PREPROD', 'UAT'] as const)(
    'SIMULATED signing in %s fails closed and is never recorded as SIGNED',
    async (environment) => {
      const h = makeHarness({ environment });
      const res = await h.call('POST', CREDENTIALS, ISSUE);
      expect(res.status).toBe(503);
      expect(errCode(res.body)).toBe('SIMULATED_CONNECTOR_FORBIDDEN');
      expect(stored(h)?.['lifecycle_status']).toBe('GENERATED');
      expect(h.repo.tenant(TENANT_A).signing).toHaveLength(0);
      expect(h.registry.calls).toHaveLength(0);
    },
  );

  it('defaults to PRODUCTION so an undeclared environment refuses SIMULATED', async () => {
    const h = makeHarness();
    const service = buildCredentialService({
      repository: h.repo,
      authorizer: h.authorizer,
      casePins: h.casePins,
      renderer: h.renderer,
      signing: h.signer,
      registry: h.registry,
    });
    const api = createCredentialApi({
      service,
      resolveContext: () => Promise.resolve(h.state.ctx),
    });
    const res = await api.handle({
      method: 'POST',
      path: CREDENTIALS,
      headers: { 'idempotency-key': 'issue-key-0005' },
      body: ISSUE,
    });
    expect(errCode(res.body)).toBe('SIMULATED_CONNECTOR_FORBIDDEN');
  });

  it('unbound ports fail closed', async () => {
    const h = makeHarness();
    const service = buildCredentialService({ repository: h.repo, authorizer: h.authorizer });
    const api = createCredentialApi({
      service,
      resolveContext: () => Promise.resolve(h.state.ctx),
    });
    const res = await api.handle({
      method: 'POST',
      path: CREDENTIALS,
      headers: { 'idempotency-key': 'issue-key-0006' },
      body: ISSUE,
    });
    expect(res.status).toBe(503);
    expect(errCode(res.body)).toBe('CASE_PINS_PORT_NOT_BOUND');
    expect(() => buildCredentialService({ authorizer: h.authorizer })).toThrow();
  });
});

describe('registry registration (CMP-024) gates ISSUED without owning status', () => {
  it('registry outage leaves SIGNED; the retry registers and issues without re-signing', async () => {
    const h = makeHarness();
    h.registry.failures = [new Error('registry down')];
    const res = await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0007' });
    expect(res.status).toBe(503);
    expect((res.body as Body)['error_code']).toBe('SF-INT-001');
    expect(stored(h)?.['lifecycle_status']).toBe('SIGNED');
    const retried = await h.call('POST', CREDENTIALS, ISSUE, { key: 'issue-key-0007' });
    expect(retried.status).toBe(201);
    expect(h.signer.calls).toHaveLength(1);
    expect(h.registry.calls.map((c) => c.idempotency_key)).toEqual([
      `cmp022.register.${CREDENTIAL_ID}`,
      `cmp022.register.${CREDENTIAL_ID}`,
    ]);
  });

  it.each(['SUSPENDED', 'REVOKED', 'REISSUED'] as const)(
    'a %s registry status does not issue',
    async (status) => {
      const h = makeHarness();
      h.registry.status = status;
      const res = await h.call('POST', CREDENTIALS, ISSUE);
      expect(errCode(res.body)).toBe('REGISTRY_STATUS_NOT_ISSUABLE');
      expect(stored(h)?.['lifecycle_status']).toBe('SIGNED');
    },
  );

  it('accepts REGISTERED and refuses an ack for another credential', async () => {
    const h = makeHarness();
    h.registry.echoId = '00000000-0000-4000-8000-000000000000';
    expect(errCode((await h.call('POST', CREDENTIALS, ISSUE)).body)).toBe('REGISTRY_ACK_INVALID');
    h.registry.echoId = null;
    h.registry.status = 'REGISTERED';
    expect((await h.call('POST', CREDENTIALS, ISSUE)).status).toBe(201);
  });
});

describe('downstream publish/notification outcomes never reverse issuance', () => {
  async function issued(): Promise<Harness> {
    const h = makeHarness();
    await h.call('POST', CREDENTIALS, ISSUE);
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'INTEGRATION');
    return h;
  }
  const outcomes = `${CREDENTIALS}/${CREDENTIAL_ID}/downstream-outcomes`;

  it.each(['DIGILOCKER_PUBLISH', 'NOTIFICATION'] as const)(
    'a FAILED %s outcome is recorded and the credential stays ISSUED',
    async (channel) => {
      const h = await issued();
      const before = { ...stored(h) };
      h.clock.advance(60_000);
      const res = await h.call('POST', outcomes, {
        channel,
        outcome: 'FAILED',
        outcome_ref: 'dispatch:0001',
        failure_code: 'SF-INT-001',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        channel,
        outcome: 'FAILED',
        failure_code: 'SF-INT-001',
        credential_lifecycle_status: 'ISSUED',
        issuance_reversed: false,
      });
      expect(stored(h)).toEqual(before);
      expect(domainEvents(h)).toEqual([
        'CredentialGenerated',
        'CredentialSigned',
        'CredentialIssued',
      ]);
      const read = await h.call('GET', `${CREDENTIALS}/${CREDENTIAL_ID}`, undefined, { key: null });
      expect((read.body as Body)['lifecycle_status']).toBe('ISSUED');
      expect((read.body as Body)['issued_at']).toBe(before['issued_at']);
    },
  );

  it('repeating an outcome ref is idempotent; a contradicting outcome conflicts', async () => {
    const h = await issued();
    const body = { channel: 'NOTIFICATION', outcome: 'SUCCEEDED', outcome_ref: 'dispatch:0002' };
    expect((await h.call('POST', outcomes, body)).status).toBe(201);
    expect((await h.call('POST', outcomes, body)).status).toBe(200);
    const conflict = await h.call('POST', outcomes, {
      ...body,
      outcome: 'FAILED',
      failure_code: 'SF-INT-001',
    });
    expect(conflict.status).toBe(409);
    expect(errCode(conflict.body)).toBe('OUTCOME_CONFLICT');
  });

  it('outcomes require an ISSUED credential', async () => {
    const h = makeHarness();
    h.registry.failures = [new Error('down')];
    await h.call('POST', CREDENTIALS, ISSUE);
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'SYSTEM');
    const res = await h.call('POST', outcomes, {
      channel: 'NOTIFICATION',
      outcome: 'SUCCEEDED',
      outcome_ref: 'dispatch:0003',
    });
    expect(res.status).toBe(409);
    expect(errCode(res.body)).toBe('CREDENTIAL_NOT_ISSUED');
    const missing = await h.call(
      'POST',
      `${CREDENTIALS}/00000000-0000-4000-8000-000000000001/downstream-outcomes`,
      { channel: 'NOTIFICATION', outcome: 'SUCCEEDED', outcome_ref: 'dispatch:0003' },
    );
    expect(missing.status).toBe(404);
  });

  it.each([
    [
      { channel: 'SMS', outcome: 'FAILED', outcome_ref: 'r1', failure_code: 'SF-INT-001' },
      'CHANNEL_INVALID',
    ],
    [{ channel: 'NOTIFICATION', outcome: 'MAYBE', outcome_ref: 'r1' }, 'OUTCOME_INVALID'],
    [{ channel: 'NOTIFICATION', outcome: 'FAILED', outcome_ref: 'r1' }, 'FAILURE_CODE_REQUIRED'],
    [
      {
        channel: 'NOTIFICATION',
        outcome: 'SUCCEEDED',
        outcome_ref: 'r1',
        failure_code: 'SF-INT-001',
      },
      'FAILURE_CODE_FORBIDDEN',
    ],
    [{ channel: 'NOTIFICATION', outcome: 'SUCCEEDED', outcome_ref: '' }, 'OUTCOME_REF_INVALID'],
    [
      {
        channel: 'NOTIFICATION',
        outcome: 'SUCCEEDED',
        outcome_ref: 'r1',
        lifecycle_status: 'GENERATED',
      },
      'CLIENT_AUTHORITY_FORBIDDEN',
    ],
  ])('rejects outcome %j with %s', async (body, code) => {
    const h = await issued();
    const res = await h.call('POST', outcomes, body);
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe(code);
  });

  it.each(['CITIZEN', 'OFFICER'] as const)('%s actors cannot record outcomes', async (t) => {
    const h = await issued();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, t);
    const res = await h.call('POST', outcomes, {
      channel: 'NOTIFICATION',
      outcome: 'SUCCEEDED',
      outcome_ref: 'r1',
    });
    expect(res.status).toBe(403);
  });
});

describe('reads', () => {
  it('GET credential, application list and signing records', async () => {
    const h = makeHarness();
    h.signer.script = [simulatedFailed];
    await h.call('POST', CREDENTIALS, ISSUE);
    await h.call('POST', CREDENTIALS, ISSUE);
    const one = await h.call('GET', `${CREDENTIALS}/${CREDENTIAL_ID}`, undefined, { key: null });
    expect(one.status).toBe(200);
    expect((one.body as Body)['lifecycle_status']).toBe('ISSUED');
    const records = await h.call(
      'GET',
      `${CREDENTIALS}/${CREDENTIAL_ID}/signing-records`,
      undefined,
      { key: null },
    );
    const list = (records.body as Body)['signing_records'] as Body[];
    expect(list.map((r) => [r['attempt_number'], r['signing_result']])).toEqual([
      [1, 'FAILED'],
      [2, 'SIGNED'],
    ]);
    expect(list[0]?.['failure_code']).toBe('SF-CRED-001');
    expect(list[0]?.['signature_ref']).toBeUndefined();
    const missing = await h.call(
      'GET',
      `${CREDENTIALS}/00000000-0000-4000-8000-000000000001/signing-records`,
      undefined,
      { key: null },
    );
    expect(missing.status).toBe(404);
    expect(
      (
        await h.call('GET', `${CREDENTIALS}/00000000-0000-4000-8000-000000000001`, undefined, {
          key: null,
        })
      ).status,
    ).toBe(404);
    expect(h.probe.violations).toBe(0);
  });
});
