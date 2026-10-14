import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeHarness as h022 } from '../../../services/cmp-022-credential-engine/test/doubles/harness.js';
import {
  APPLICATION_ID,
  ISSUANCE_KEY,
} from '../../../services/cmp-022-credential-engine/test/doubles/fixtures.js';
import {
  makeHarness as h024,
  BASE,
} from '../../../services/cmp-024-credential-registry/test/doubles/harness.js';
import { CRED_1 as REG_CRED } from '../../../services/cmp-024-credential-registry/test/doubles/fixtures.js';
import { makeHarness as h023 } from '../../../services/cmp-023-qr-verification/test/doubles/harness.js';
import { issueBody } from '../../../services/cmp-023-qr-verification/test/doubles/fixtures.js';
import { createDigilockerApi } from '../../../services/cmp-012-digilocker/src/api/handler.js';
import { DigiLockerService } from '../../../services/cmp-012-digilocker/src/service/service.js';
import { SimulatedDigiLockerConnector } from '../../../services/cmp-012-digilocker/src/connectors/simulated-digilocker.js';
import {
  BINDING_ID,
  CONSENT_REF,
  CREDENTIAL_ID,
  ctxFor as ctx012,
  DOCUMENT_TYPE_REF,
  FakeConnectorBindingPort,
  FakeCredentialVerificationPort,
  PURPOSE_CODE,
  TENANT_A as T012,
  TEST_RUN_ID,
} from '../../../services/cmp-012-digilocker/test/doubles/fixtures.js';
import { MemoryDigilockerRepository } from '../../../services/cmp-012-digilocker/test/doubles/memory-repo.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
type Decide = (input: Record<string, any>) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Malformed PDP outputs: none of these is an explicit `allow: true`. */
const MALFORMED: ReadonlyArray<[string, unknown]> = [
  ['null', null],
  ['empty', {}],
  ['allow-string-true', { allow: 'true', reason_code: 'ALLOW' }],
  ['allow-number-1', { allow: 1, reason_code: 'ALLOW' }],
];

function harness012() {
  const repo = new MemoryDigilockerRepository();
  const calls: Array<Record<string, unknown>> = [];
  const state: { decide: Decide } = {
    decide: (input) => {
      calls.push(input);
      return Promise.resolve({
        allow: true,
        reason_code: 'ALLOW',
        policy_revision: 'r',
        decision_id: BINDING_ID,
      });
    },
  };
  const service = new DigiLockerService({
    repo,
    authorizer: { decide: (i) => state.decide(i as never) as never },
    connectorBinding: new FakeConnectorBindingPort('LOCAL'),
    credentialVerification: new FakeCredentialVerificationPort(T012),
    digilockerApi: new SimulatedDigiLockerConnector({
      simulation: true,
      scenario: 'digilocker_publish',
      test_run_id: TEST_RUN_ID,
      connector_binding_id: BINDING_ID,
      environment: 'LOCAL',
    }),
    runtimeEnvironment: 'LOCAL',
    clock: () => new Date('2026-10-14T05:00:00Z'),
  });
  const ctx = ctx012(T012);
  const api = createDigilockerApi({ service, resolveContext: () => Promise.resolve(ctx) });
  let n = 0;
  const publish = () =>
    api.handle({
      method: 'POST',
      path: '/v1/digilocker-publish',
      headers: { 'idempotency-key': `sec-012-key-${String((n += 1)).padStart(6, '0')}` },
      body: {
        credential_id: CREDENTIAL_ID,
        consent_ref: CONSENT_REF,
        purpose_code: PURPOSE_CODE,
        document_type_ref: DOCUMENT_TYPE_REF,
        test_run_id: TEST_RUN_ID,
      },
    });
  return { repo, state, calls, publish, ctx };
}

describe('SF-M07-SEC authz: deny-by-default on every M07 component', () => {
  it('CMP-022: PDP deny → 403 SF-AUTH-002, outage → 503 SF-SYS-004, malformed → deny; no writes', async () => {
    const h = h022();
    const issue = { application_id: APPLICATION_ID, issuance_key: ISSUANCE_KEY };
    const decide = h.authorizer.decide.bind(h.authorizer) as Decide;
    const cases: Array<[string, Decide, number, string]> = [
      ['deny', () => Promise.resolve({ allow: false, reason_code: 'DENY' }), 403, 'SF-AUTH-002'],
      ['outage', () => Promise.reject(new Error('pdp down')), 503, 'SF-SYS-004'],
      ...MALFORMED.map(
        ([l, v]) =>
          [l, () => Promise.resolve(v), 403, 'SF-AUTH-002'] as [string, Decide, number, string],
      ),
    ];
    for (const [label, fn, status, code] of cases) {
      (h.authorizer as unknown as { decide: Decide }).decide = fn;
      const res = await h.call('POST', '/v1/credentials', issue);
      expect(res.status, label).toBe(status);
      expect((res.body as Body)['error_code'], label).toBe(code);
      const read = await h.call(
        'GET',
        `/v1/applications/${APPLICATION_ID}/credentials`,
        undefined,
        { key: null },
      );
      expect(read.status, `read ${label}`).toBe(status);
    }
    expect(h.repo.tenant(String(h.state.ctx?.tenant_id)).credentials.size).toBe(0);
    expect(h.renderer.calls).toHaveLength(0);
    expect(h.signer.calls).toHaveLength(0);
    (h.authorizer as unknown as { decide: Decide }).decide = decide;
  });

  it('CMP-024: every lifecycle command and the status read deny by default', async () => {
    const h = h024();
    await h.active(REG_CRED);
    const cases: Array<[string, Decide, number]> = [
      ['deny', () => Promise.resolve({ allow: false, reason_code: 'DENY' }), 403],
      ['outage', () => Promise.reject(new Error('pdp down')), 503],
      ...MALFORMED.map(([l, v]) => [l, () => Promise.resolve(v), 403] as [string, Decide, number]),
    ];
    for (const [label, fn, status] of cases) {
      (h.authorizer as unknown as { decide: Decide }).decide = fn;
      for (const verb of ['suspend', 'revoke', 'reissue', 'activate', 'reinstate']) {
        const extra =
          verb === 'reissue'
            ? { ...h.reason, superseded_by_credential_id: CREDENTIAL_ID }
            : h.reason;
        const res = await h.transition(REG_CRED, verb, 2, extra);
        expect(res.status, `${label} ${verb}`).toBe(status);
      }
      const read = await h.call('GET', `${BASE}/${REG_CRED}/status`);
      expect(read.status, `read ${label}`).toBe(status);
    }
    (h.authorizer as unknown as { decide: Decide }).decide = () =>
      Promise.resolve({ allow: true, reason_code: 'ALLOW' });
    const after = await h.call('GET', `${BASE}/${REG_CRED}/status`);
    expect(after.body['credential_status']['current_status']).toBe('ACTIVE');
    expect(after.body['status_version']).toBe(2);
  });

  it('CMP-023: token issue, issuer read and public verify deny by default', async () => {
    const h = h023();
    const cases: Array<[string, Decide, number]> = [
      ['deny', () => Promise.resolve({ allow: false, reason_code: 'DENY' }), 403],
      ['outage', () => Promise.reject(new Error('pdp down')), 503],
      ...MALFORMED.map(([l, v]) => [l, () => Promise.resolve(v), 403] as [string, Decide, number]),
    ];
    for (const [label, fn, status] of cases) {
      (h.authorizer as unknown as { decide: Decide }).decide = fn;
      expect((await h.call('POST', '/v1/qr/tokens', issueBody())).status, `issue ${label}`).toBe(
        status,
      );
      expect((await h.call('GET', `/v1/qr/tokens/${CREDENTIAL_ID}`)).status, `read ${label}`).toBe(
        status,
      );
      expect(
        (await h.call('GET', `/v1/qr/verify/${'a'.repeat(43)}`)).status,
        `verify ${label}`,
      ).toBe(status);
    }
    expect(h.registry.calls).toBe(0);
  });

  it('CMP-012: PDP deny → 403, outage → 503; nothing persisted or sent to the connector', async () => {
    const h = harness012();
    h.state.decide = () => Promise.resolve({ allow: false, reason_code: 'DENY' });
    expect((await h.publish()).status).toBe(403);
    h.state.decide = () => Promise.reject(new Error('pdp down'));
    expect((await h.publish()).status).toBe(503);
    expect(h.repo.stores.get(T012)?.publishRecords?.size ?? 0).toBe(0);
  });

  it('FINDING M07-SEC-F04: CMP-012 treats a truthy non-boolean PDP allow as permit, and a null decision as 500', async () => {
    const outcomes: Record<string, number> = {};
    for (const [label, value] of MALFORMED) {
      const h = harness012();
      h.state.decide = () => Promise.resolve(value);
      outcomes[label] = (await h.publish()).status;
    }
    // CMP-022/023/024 require `allow === true` (above). CMP-012 uses `!decision.allow`.
    expect(outcomes['empty']).toBe(403);
    expect(outcomes['allow-string-true']).toBe(201);
    expect(outcomes['allow-number-1']).toBe(201);
    expect(outcomes['null']).toBeGreaterThanOrEqual(500);
  });

  it('PEP inputs carry only the server-derived tenant on subject and resource', async () => {
    const h = h024();
    await h.active(REG_CRED);
    await h.call('GET', `${BASE}/${REG_CRED}/status`, undefined, { headers: {} });
    for (const call of h.authorizer.calls) {
      expect(call.subject.tenant_id).toBe(call.resource.tenant_id);
      expect(call.subject.tenant_id).toBe(h.state.ctx?.tenant_id);
    }
    const d = harness012();
    await d.publish();
    for (const call of d.calls as Array<{
      subject: { tenant_id: string };
      resource: { tenant_id: string };
    }>) {
      expect(call.subject.tenant_id).toBe(d.ctx.tenant_id);
      expect(call.resource.tenant_id).toBe(d.ctx.tenant_id);
    }
  });

  it('OPA bundle: default deny and no M07 action is in the catalogue (live PDP would deny UNKNOWN_ACTION)', () => {
    const decision = readFileSync(join(ROOT, 'policy/opa/sf/authz/decision.rego'), 'utf8');
    expect(decision).toMatch(/default allow := false/);
    expect(decision).toMatch(/"UNKNOWN_ACTION"/);
    const data = JSON.parse(readFileSync(join(ROOT, 'policy/opa/sf/common/data.json'), 'utf8')) as {
      actions: unknown;
    };
    const catalogue = JSON.stringify(data.actions);
    for (const action of [
      'CREDENTIAL_ISSUE',
      'CREDENTIAL_READ',
      'CREDENTIAL_REGISTRY_REVOKE',
      'CREDENTIAL_REGISTRY_STATUS_READ',
      'QR_TOKEN_VERIFY',
      'digilocker:publish',
    ]) {
      expect(catalogue.includes(`"${action}"`), action).toBe(false);
    }
  });
});
