import { randomUUID } from 'node:crypto';
import type { ConnectorBinding, RequestContext } from '@serviceform/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { SimulatedDigiLockerEvidenceAdapter } from '../../src/connectors/digilocker-simulated.js';
import { registerEvidence } from '../../src/plugin.js';
import { DenyApprovalPort } from '../../src/ports/approval.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures, setFixture } from '../doubles/context-resolver.js';
import {
  StaticBindingPins,
  StaticClassifier,
  StaticUploads,
  ToggleApproval,
  ToggleConsent,
} from '../doubles/ports.js';
import { samplePolicy } from '../fixtures/policy.js';
import type { OptionOut, ReqOut, SetOut } from '../fixtures/types.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BINDING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DL_BINDING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TRACE = '0af7651916cd43dd8448eb211c80319c';
const NOW = '2026-10-04T12:00:00.000Z';

function ctx(tenant: string | null): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: ACTOR },
    roles: ['SERVICE_DESIGNER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

function dlBinding(
  tenant: string | null = T1,
  mode: ConnectorBinding['mode'] = 'SIMULATED',
): ConnectorBinding {
  return {
    connector_binding_id: DL_BINDING_ID,
    tenant_id: tenant,
    connector_type: 'DIGILOCKER',
    mode,
    environment: 'CI',
    critical: false,
    secret_ref: null,
    simulator_version: '1',
  };
}

function headers(token: string, key?: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) };
}

describe('CMP-011 HTTP plugin (memory repository)', () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let pins: StaticBindingPins;
  let uploads: StaticUploads;
  let classifier: StaticClassifier;
  let consent: ToggleConsent;
  let approval: ToggleApproval;
  let authorizer: ContractAuthorizer;

  async function build(extra: Partial<Parameters<typeof registerEvidence>[1]> = {}) {
    const instance = Fastify({ logger: false });
    await registerEvidence(instance, {
      pool: createMemoryPool(store),
      resolveContext: fixtureResolver,
      bindingPins: pins,
      authorizer,
      approval,
      uploads,
      classification: classifier,
      consent,
      clock: () => new Date(NOW),
      config: loadConfig({ SF_ENVIRONMENT: 'CI', SF_CMP011_RATE_LIMIT_MAX: '1000' }),
      digiLockerBinding: dlBinding(),
      ...extra,
    });
    return instance;
  }

  async function publishPolicy(
    token: string,
    definition: unknown = samplePolicy(),
    key = 'generic.policy',
  ) {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers(token, `c-${randomUUID()}`),
      payload: { policy_key: key, definition },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().policy_id as string;
    const published = await app.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${id}/publish`,
      headers: headers(token, `p-${randomUUID()}`),
    });
    expect(published.statusCode).toBe(200);
    return published.json() as { policy_id: string; version_ref: string; content_hash: string };
  }

  function calc(token: string, body: Record<string, unknown>, key = `k-${randomUUID()}`) {
    return app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: headers(token, key),
      payload: body,
    });
  }

  const baseBody = {
    binding_id: BINDING_ID,
    facts: { 'applicant.category': 'P', 'applicant.age': 30 },
    rule_outcomes: { needs_extra: false },
  };

  beforeEach(async () => {
    fixtures.clear();
    setFixture('t1', ctx(T1));
    setFixture('t2', ctx(T2));
    setFixture('platform', ctx(null));
    store = emptyStore();
    pins = new StaticBindingPins();
    uploads = new StaticUploads();
    classifier = new StaticClassifier();
    consent = new ToggleConsent();
    approval = new ToggleApproval();
    authorizer = new ContractAuthorizer();
    app = await build();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates, patches, publishes and reads policy versions; published versions are immutable', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1', 'idem-1'),
      payload: { policy_key: 'generic.policy', definition: samplePolicy() },
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json();
    expect(draft.status).toBe('DRAFT');
    expect(draft.version_ref).toBeNull();

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1', 'idem-1'),
      payload: { policy_key: 'generic.policy', definition: samplePolicy() },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().policy_id).toBe(draft.policy_id);
    expect(store.policies).toHaveLength(1);

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1', 'idem-1'),
      payload: { policy_key: 'other.policy', definition: samplePolicy() },
    });
    expect(conflict.json().error_code).toBe('SF-APP-002');

    const next = samplePolicy();
    next.evidence_types.push({
      code: 'NEW_DOC',
      label_key: 'evidence.new_doc',
      sources: [{ source: 'UPLOAD' }],
      reusable: false,
    });
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/evidence-policies/${draft.policy_id}`,
      headers: headers('t1', 'idem-2'),
      payload: { definition: next },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().content_hash).not.toBe(draft.content_hash);

    const published = await app.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${draft.policy_id}/publish`,
      headers: headers('t1', 'idem-3'),
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().version_ref).toBe('generic.policy@1');
    expect(published.json().status).toBe('PUBLISHED');

    const after = await app.inject({
      method: 'PATCH',
      url: `/v1/evidence-policies/${draft.policy_id}`,
      headers: headers('t1', 'idem-4'),
      payload: { definition: samplePolicy() },
    });
    expect(after.statusCode).toBe(400);
    expect(after.json().details[0].code).toBe('PUBLISHED_IMMUTABLE');
    const republish = await app.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${draft.policy_id}/publish`,
      headers: headers('t1', 'idem-5'),
    });
    expect(republish.json().details[0].code).toBe('PUBLISHED_IMMUTABLE');

    const read = await app.inject({
      method: 'GET',
      url: `/v1/evidence-policies/${draft.policy_id}`,
      headers: headers('t1'),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().version_ref).toBe('generic.policy@1');
    expect(store.outbox.length).toBeGreaterThanOrEqual(5);
  });

  it('validates metadata, keys and ids', async () => {
    const badPolicy = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1', 'i1'),
      payload: { policy_key: 'generic.policy', definition: { schema_version: 1 } },
    });
    expect(badPolicy.statusCode).toBe(400);
    const badKey = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1', 'i2'),
      payload: { policy_key: 'Bad Key', definition: samplePolicy() },
    });
    expect(badKey.json().details[0].code).toBe('INVALID_POLICY_KEY');
    const noKey = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1', 'i3'),
      payload: { definition: samplePolicy() },
    });
    expect(noKey.statusCode).toBe(400);
    const noIdem = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1'),
      payload: { policy_key: 'generic.policy', definition: samplePolicy() },
    });
    expect(noIdem.json().details[0].code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    for (const [method, url] of [
      ['GET', '/v1/evidence-policies/not-a-uuid'],
      ['PATCH', '/v1/evidence-policies/not-a-uuid'],
      ['POST', '/v1/evidence-policies/not-a-uuid/publish'],
      ['GET', '/v1/evidence-resolutions/not-a-uuid'],
    ] as const) {
      const res = await app.inject({ method, url, headers: headers('t1', 'x') });
      expect(res.statusCode).toBe(400);
    }
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/evidence-policies/${randomUUID()}`,
      headers: headers('t1'),
    });
    expect(missing.statusCode).toBe(404);
    const patchMissing = await app.inject({
      method: 'PATCH',
      url: `/v1/evidence-policies/${randomUUID()}`,
      headers: headers('t1', 'pm'),
      payload: { definition: samplePolicy() },
    });
    expect(patchMissing.statusCode).toBe(404);
    const publishMissing = await app.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${randomUUID()}/publish`,
      headers: headers('t1', 'pu'),
    });
    expect(publishMissing.statusCode).toBe(404);
  });

  it('requires checker approval to publish and degrades safely when approval is unavailable', async () => {
    const denied = await build({ approval: new DenyApprovalPort() });
    const created = await denied.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: headers('t1', 'a1'),
      payload: { policy_key: 'generic.policy', definition: samplePolicy() },
    });
    const res = await denied.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${created.json().policy_id}/publish`,
      headers: headers('t1', 'a2'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].code).toBe('CHECKER_APPROVAL_REQUIRED');
    await denied.close();

    approval.throws = true;
    const down = await app.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${created.json().policy_id}/publish`,
      headers: headers('t1', 'a3'),
    });
    expect(down.json().error_code).toBe('SF-SYS-004');
    expect(store.policies.find((p) => p.status === 'PUBLISHED')).toBeUndefined();
  });

  it('versions: later publication does not change what an earlier pin resolves', async () => {
    const v1 = await publishPolicy('t1');
    const v2def = samplePolicy();
    (v2def.requirements[1] as { alternative_sets: unknown[] }).alternative_sets = [
      { code: 'SET_ONLY_Z', evidence_type_codes: ['PLACE_DOC_Z'] },
    ];
    const v2 = await publishPolicy('t1', v2def);
    expect(v2.version_ref).toBe('generic.policy@2');
    pins.set(T1, BINDING_ID, {
      version_ref: v1.version_ref,
      content_hash: v1.content_hash,
      binding_status: 'PUBLISHED',
    });
    const second = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    pins.set(T1, second, {
      version_ref: v2.version_ref,
      content_hash: v2.content_hash,
      binding_status: 'SUPERSEDED',
    });

    const a = await calc('t1', baseBody);
    const b = await calc('t1', { ...baseBody, binding_id: second });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().evidence_policy_version.version_ref).toBe('generic.policy@1');
    expect(b.json().evidence_policy_version.version_ref).toBe('generic.policy@2');
    const sets = (r: { json: () => { checklist: { requirements: ReqOut[] } } }) =>
      r
        .json()
        .checklist.requirements.find((x: ReqOut) => x.requirement_code === 'REQ_PLACE')
        ?.alternative_sets.map((s: SetOut) => s.set_code);
    expect(sets(a)).toEqual(['SET_PLACE_X', 'SET_PLACE_YZ']);
    expect(sets(b)).toEqual(['SET_ONLY_Z']);
  });

  describe('calculate', () => {
    let pinned: { version_ref: string; content_hash: string };
    beforeEach(async () => {
      pinned = await publishPolicy('t1');
      pins.set(T1, BINDING_ID, { ...pinned, binding_status: 'PUBLISHED' });
    });

    it('resolves requirements from the pinned published policy, stores the outcome and replays idempotently', async () => {
      const res = await calc('t1', { ...baseBody, application_ref: 'APP-1' }, 'calc-1');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.evidence_policy_version.version_ref).toBe(pinned.version_ref);
      expect(body.evidence_policy_version.content_hash).toBe(pinned.content_hash);
      expect(body.checklist.requirements.map((r: ReqOut) => r.requirement_code)).toEqual([
        'REQ_IDENTITY',
        'REQ_PLACE',
        'REQ_EXTRA',
      ]);
      expect(body.decision_hash).toMatch(/^sha256:/);
      expect(body.simulated).toBe(false);
      expect(store.resolutions).toHaveLength(1);

      const replay = await calc('t1', { ...baseBody, application_ref: 'APP-1' }, 'calc-1');
      expect(replay.json().resolution_id).toBe(body.resolution_id);
      expect(store.resolutions).toHaveLength(1);

      const read = await app.inject({
        method: 'GET',
        url: `/v1/evidence-resolutions/${body.resolution_id}`,
        headers: headers('t1'),
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().decision_hash).toBe(body.decision_hash);
      expect(read.json().application_ref).toBe('APP-1');
    });

    it('is deterministic: the same inputs and clock give the same decision hash', async () => {
      const a = await calc('t1', baseBody);
      const b = await calc('t1', baseBody);
      expect(a.json().decision_hash).toBe(b.json().decision_hash);
      expect(a.json().input_hash).toBe(b.json().input_hash);
      expect(a.json().resolution_id).not.toBe(b.json().resolution_id);
    });

    it('uses uploaded evidence from the upload port and keeps OCR suggestions advisory', async () => {
      uploads.docs = [
        {
          evidence_ref: 'up-1',
          evidence_type_code: 'ID_DOC_B',
          source: 'UPLOAD',
          verification: 'VERIFIED',
          scope: 'APPLICATION',
        },
        {
          evidence_ref: 'up-2',
          evidence_type_code: null,
          source: 'UPLOAD',
          verification: 'UNVERIFIED',
          scope: 'APPLICATION',
        },
        {
          evidence_ref: 'up-3',
          evidence_type_code: 'NOT_IN_POLICY',
          source: 'UPLOAD',
          verification: 'VERIFIED',
          scope: 'APPLICATION',
        },
        {
          evidence_ref: '!bad',
          evidence_type_code: 'ID_DOC_B',
          source: 'UPLOAD',
          verification: 'VERIFIED',
          scope: 'APPLICATION',
        },
        {
          evidence_ref: 'up-4',
          evidence_type_code: 'ID_DOC_B',
          source: 'FAX' as never,
          verification: 'VERIFIED',
          scope: 'APPLICATION',
        },
      ];
      classifier.suggestion = { evidence_type_code: 'PLACE_DOC_Y', confidence: 0.99 };
      const res = await calc('t1', { ...baseBody, include_uploaded: true, subject_id: SUBJECT });
      expect(res.statusCode).toBe(200);
      const checklist = res.json().checklist;
      const identity = checklist.requirements.find(
        (r: ReqOut) => r.requirement_code === 'REQ_IDENTITY',
      );
      expect(identity.status).toBe('SATISFIED');
      const place = checklist.requirements.find((r: ReqOut) => r.requirement_code === 'REQ_PLACE');
      expect(place.status).toBe('REQUIRED');
      expect(checklist.advisory_evidence).toEqual([
        { evidence_ref: 'up-2', evidence_type_code: 'PLACE_DOC_Y' },
      ]);
    });

    it('requires a subject id to read uploads and tolerates an unconfigured classifier', async () => {
      const missing = await calc('t1', { ...baseBody, include_uploaded: true });
      expect(missing.json().details[0].code).toBe('SUBJECT_ID_REQUIRED');
      const noClassifier = await build({ classification: undefined as never });
      uploads.docs = [
        {
          evidence_ref: 'up-2',
          evidence_type_code: null,
          source: 'UPLOAD',
          verification: 'UNVERIFIED',
          scope: 'APPLICATION',
        },
      ];
      const res = await noClassifier.inject({
        method: 'POST',
        url: '/v1/evidence-requirements/calculate',
        headers: headers('t1', 'nc-1'),
        payload: { ...baseBody, include_uploaded: true, subject_id: SUBJECT },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().checklist.advisory_evidence).toEqual([]);
      await noClassifier.close();
    });

    it('fails closed when a consumed port is unavailable', async () => {
      uploads.throws = true;
      const up = await calc('t1', { ...baseBody, include_uploaded: true, subject_id: SUBJECT });
      expect(up.statusCode).toBe(503);
      expect(up.json().details[0].code).toBe('UPLOAD_PORT_UNAVAILABLE');
      pins.throws = true;
      const pin = await calc('t1', baseBody);
      expect(pin.json().details[0].code).toBe('BINDING_PORT_UNAVAILABLE');
      expect(store.resolutions).toHaveLength(0);
    });

    it('rejects bad input, unpublished bindings and tampered pins', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ ...baseBody, binding_id: 'nope' }, 'BINDING_ID'],
        [{ ...baseBody, extra: 1 }, 'UNKNOWN_FIELD'],
        [{ ...baseBody, facts: { 'Bad Key': 1 } }, 'SCALAR_MAP_INVALID'],
        [{ ...baseBody, facts: { a: { nested: 1 } } }, 'SCALAR_MAP_INVALID'],
        [{ ...baseBody, facts: [] }, 'SCALAR_MAP_INVALID'],
        [{ ...baseBody, subject_id: 'x' }, 'SUBJECT_ID'],
        [{ ...baseBody, application_ref: '!' }, 'APPLICATION_REF'],
        [{ ...baseBody, include_uploaded: 'yes' }, 'INCLUDE_UPLOADED'],
        [{ ...baseBody, digilocker: 3 }, 'DIGILOCKER_INVALID'],
        [
          {
            ...baseBody,
            digilocker: { purpose_code: 'p', scenario: 'all_available', test_run_id: 't' },
          },
          'PURPOSE_CODE',
        ],
        [
          { ...baseBody, digilocker: { purpose_code: 'KYC', scenario: 'Bad', test_run_id: 't' } },
          'SCENARIO',
        ],
        [
          {
            ...baseBody,
            digilocker: { purpose_code: 'KYC', scenario: 'all_available', test_run_id: '' },
          },
          'TEST_RUN_ID',
        ],
        [
          {
            ...baseBody,
            digilocker: { purpose_code: 'KYC', scenario: 'all_available', test_run_id: 't', x: 1 },
          },
          'UNKNOWN_FIELD',
        ],
      ];
      for (const [body, code] of cases) {
        const res = await calc('t1', body);
        expect(res.statusCode, code).toBe(400);
        expect(res.json().details[0].code).toBe(code);
      }
      const notObject = await app.inject({
        method: 'POST',
        url: '/v1/evidence-requirements/calculate',
        headers: headers('t1', 'ni'),
        payload: '"text"',
      });
      expect(notObject.statusCode).toBeGreaterThanOrEqual(400);

      const draftBinding = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      pins.set(T1, draftBinding, { ...pinned, binding_status: 'DRAFT' });
      expect(
        (await calc('t1', { ...baseBody, binding_id: draftBinding })).json().details[0].code,
      ).toBe('BINDING_NOT_PUBLISHED');

      const tampered = '99999999-9999-4999-8999-999999999999';
      pins.set(T1, tampered, {
        ...pinned,
        content_hash: `sha256:${'0'.repeat(64)}`,
        binding_status: 'PUBLISHED',
      });
      expect((await calc('t1', { ...baseBody, binding_id: tampered })).json().details[0].code).toBe(
        'PIN_HASH_MISMATCH',
      );

      const unknownVersion = '88888888-8888-4888-8888-888888888888';
      pins.set(T1, unknownVersion, {
        ...pinned,
        version_ref: 'ghost@9',
        binding_status: 'PUBLISHED',
      });
      const ghost = await calc('t1', { ...baseBody, binding_id: unknownVersion });
      expect(ghost.statusCode).toBe(404);
      expect(ghost.json().details[0].code).toBe('EVIDENCE_POLICY_VERSION_NOT_FOUND');

      const corrupted = store.policies.find((p) => p.status === 'PUBLISHED');
      (corrupted as { definition: unknown }).definition = {
        ...samplePolicy(),
        requirements: samplePolicy().requirements.slice(0, 1),
      };
      expect((await calc('t1', baseBody)).json().details[0].code).toBe('POLICY_HASH_MISMATCH');
    });

    describe('DigiLocker via INT-013 SIMULATED adapter', () => {
      const dl = (scenario: string) => ({
        ...baseBody,
        subject_id: SUBJECT,
        digilocker: { purpose_code: 'EVIDENCE_LOOKUP', scenario, test_run_id: 'run-1' },
      });

      it('uses DigiLocker documents as verified evidence and tags the result as simulated', async () => {
        const res = await calc('t1', dl('all_available'));
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.simulated).toBe(true);
        expect(body.digilocker.status).toBe('OK');
        expect(body.digilocker.simulation).toMatchObject({
          simulation: true,
          scenario: 'all_available',
          test_run_id: 'run-1',
          connector_binding_id: DL_BINDING_ID,
          environment: 'CI',
        });
        const reqs = body.checklist.requirements;
        expect(reqs.find((r: ReqOut) => r.requirement_code === 'REQ_IDENTITY').status).toBe(
          'SATISFIED',
        );
        expect(reqs.find((r: ReqOut) => r.requirement_code === 'REQ_PLACE').status).toBe(
          'SATISFIED',
        );
        expect(consent.calls).toBe(1);
        expect(
          store.outbox.some((row) => String(row[row.length - 1]).includes('"simulation":true')),
        ).toBe(true);
      });

      it('offers upload when DigiLocker has no document', async () => {
        const res = await calc('t1', dl('none_available'));
        const identity = res
          .json()
          .checklist.requirements.find((r: ReqOut) => r.requirement_code === 'REQ_IDENTITY');
        expect(identity.status).toBe('REQUIRED');
        const options = identity.alternative_sets[0].items[0].options;
        expect(options.map((o: OptionOut) => [o.source, o.availability, o.recommended])).toEqual([
          ['DIGILOCKER', 'UNAVAILABLE', false],
          ['UPLOAD', 'ALWAYS', true],
        ]);
      });

      it('does not satisfy from expired DigiLocker documents', async () => {
        const res = await calc('t1', dl('expired'));
        const identity = res
          .json()
          .checklist.requirements.find((r: ReqOut) => r.requirement_code === 'REQ_IDENTITY');
        expect(identity.status).toBe('REQUIRED');
        expect(identity.alternative_sets[0].items[0].rejections[0].reason_code).toBe(
          'EVIDENCE_EXPIRED',
        );
      });

      it('degrades to upload options when the provider is down (no lost request)', async () => {
        const res = await calc('t1', dl('outage'));
        expect(res.statusCode).toBe(200);
        expect(res.json().digilocker).toEqual({ status: 'UNAVAILABLE' });
        expect(res.json().simulated).toBe(false);
        const identity = res
          .json()
          .checklist.requirements.find((r: ReqOut) => r.requirement_code === 'REQ_IDENTITY');
        expect(identity.alternative_sets[0].items[0].options[0].availability).toBe('UNKNOWN');
      });

      it('rejects unknown scenarios and enforces consent', async () => {
        const unknown = await calc('t1', dl('made_up'));
        expect(unknown.json().details[0].code).toBe('SCENARIO_UNKNOWN');
        consent.allowed = false;
        const denied = await calc('t1', dl('all_available'));
        expect(denied.statusCode).toBe(403);
        expect(denied.json().details[0].code).toBe('CONSENT_REQUIRED');
        consent.allowed = true;
        consent.throws = true;
        const down = await calc('t1', dl('all_available'));
        expect(down.json().details[0].code).toBe('CONSENT_PORT_UNAVAILABLE');
        expect(store.resolutions).toHaveLength(0);
      });

      it('requires a subject id and a configured binding/consent port', async () => {
        const noSubject = await calc('t1', { ...dl('all_available'), subject_id: undefined });
        expect(noSubject.json().details[0].code).toBe('SUBJECT_ID_REQUIRED');
        const unconfigured = await build({ digiLockerBinding: undefined as never });
        const res = await unconfigured.inject({
          method: 'POST',
          url: '/v1/evidence-requirements/calculate',
          headers: headers('t1', 'u-1'),
          payload: dl('all_available'),
        });
        expect(res.json().details[0].code).toBe('DIGILOCKER_NOT_CONFIGURED');
        await unconfigured.close();
        const noConsent = await build({ consent: undefined as never });
        const res2 = await noConsent.inject({
          method: 'POST',
          url: '/v1/evidence-requirements/calculate',
          headers: headers('t1', 'u-2'),
          payload: dl('all_available'),
        });
        expect(res2.json().details[0].code).toBe('CONSENT_PORT_REQUIRED');
        await noConsent.close();
      });

      it('refuses adapters that return no valid simulation marker', async () => {
        const bad = await build({
          digiLocker: {
            async lookupDocuments() {
              return { documents: [], simulation: { simulation: true } as never };
            },
          },
        });
        const res = await bad.inject({
          method: 'POST',
          url: '/v1/evidence-requirements/calculate',
          headers: headers('t1', 'm-1'),
          payload: dl('all_available'),
        });
        expect(res.json().details[0].code).toBe('SIMULATION_MARKER_REQUIRED');
        await bad.close();
      });

      it('treats unexpected adapter failures as provider unavailable', async () => {
        const boom = await build({
          digiLocker: {
            async lookupDocuments() {
              throw new Error('socket hang up');
            },
          },
        });
        const res = await boom.inject({
          method: 'POST',
          url: '/v1/evidence-requirements/calculate',
          headers: headers('t1', 'b-1'),
          payload: dl('all_available'),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().digilocker.status).toBe('UNAVAILABLE');
        await boom.close();
      });
    });
  });

  describe('tenant isolation (negative)', () => {
    it('hides policies, resolutions and bindings across tenants', async () => {
      const pinned = await publishPolicy('t1');
      pins.set(T1, BINDING_ID, { ...pinned, binding_status: 'PUBLISHED' });
      const resolved = await calc('t1', baseBody);
      expect(resolved.statusCode).toBe(200);

      const policy = await app.inject({
        method: 'GET',
        url: `/v1/evidence-policies/${pinned.policy_id}`,
        headers: headers('t2'),
      });
      expect(policy.statusCode).toBe(404);
      const resolution = await app.inject({
        method: 'GET',
        url: `/v1/evidence-resolutions/${resolved.json().resolution_id}`,
        headers: headers('t2'),
      });
      expect(resolution.statusCode).toBe(404);
      const crossBinding = await calc('t2', baseBody);
      expect(crossBinding.statusCode).toBe(404);
      expect(pins.calls.at(-1)?.tenant_id).toBe(T2);
      const patch = await app.inject({
        method: 'PATCH',
        url: `/v1/evidence-policies/${pinned.policy_id}`,
        headers: headers('t2', 'x-1'),
        payload: { definition: samplePolicy() },
      });
      expect(patch.statusCode).toBe(404);
      const body = JSON.stringify([policy.json(), resolution.json(), crossBinding.json()]);
      expect(body).not.toContain(pinned.version_ref);
      expect(body).not.toContain(pinned.content_hash);
    });

    it('rejects tenant-identifying headers, missing/unknown context and platform (null-tenant) actors', async () => {
      const tenantHeader = await app.inject({
        method: 'GET',
        url: `/v1/evidence-policies/${randomUUID()}`,
        headers: { ...headers('t1'), 'x-tenant-id': T2 },
      });
      expect(tenantHeader.statusCode).toBe(403);
      const forwarded = await app.inject({
        method: 'GET',
        url: `/v1/evidence-policies/${randomUUID()}`,
        headers: { ...headers('t1'), forwarded: `for=1.2.3.4;tenant=${T2}` },
      });
      expect(forwarded.statusCode).toBe(403);
      const anon = await app.inject({
        method: 'GET',
        url: `/v1/evidence-policies/${randomUUID()}`,
      });
      expect(anon.statusCode).toBe(401);
      const platform = await app.inject({
        method: 'GET',
        url: `/v1/evidence-policies/${randomUUID()}`,
        headers: headers('platform'),
      });
      expect(platform.statusCode).toBe(401);
      expect(platform.json().error_code).toBe('SF-TEN-001');
    });

    it('denies by default and on PDP failure (no data returned)', async () => {
      const pinned = await publishPolicy('t1');
      pins.set(T1, BINDING_ID, { ...pinned, binding_status: 'PUBLISHED' });
      authorizer.denies.add('EVIDENCE_REQUIREMENTS_CALCULATE');
      const denied = await calc('t1', baseBody);
      expect(denied.statusCode).toBe(403);
      authorizer.denies.clear();
      authorizer.throws = true;
      const down = await calc('t1', baseBody);
      expect(down.json().error_code).toBe('SF-SYS-004');
      expect(store.resolutions).toHaveLength(0);

      const closed = await build({ authorizer: undefined as never });
      const res = await closed.inject({
        method: 'GET',
        url: `/v1/evidence-policies/${pinned.policy_id}`,
        headers: headers('t1'),
      });
      expect(res.statusCode).toBe(403);
      await closed.close();
    });
  });

  describe('INT-013 production and mode guards', () => {
    it('refuses SIMULATED DigiLocker in PRODUCTION and REAL/SANDBOX modes in M04', async () => {
      expect(() => loadConfig({ SF_ENVIRONMENT: 'PRODUCTION' })).toThrow();
      expect(() =>
        loadConfig({ SF_ENVIRONMENT: 'UAT', SF_CMP011_DIGILOCKER_MODE: 'SIMULATED' }),
      ).toThrow();
      expect(() =>
        loadConfig({ SF_ENVIRONMENT: 'CI', SF_CMP011_DIGILOCKER_MODE: 'REAL' }),
      ).toThrow();
      expect(() =>
        loadConfig({ SF_ENVIRONMENT: 'CI', SF_CMP011_DIGILOCKER_MODE: 'SANDBOX' }),
      ).toThrow();
      expect(() =>
        loadConfig({ SF_ENVIRONMENT: 'CI', SF_CMP011_DIGILOCKER_MODE: 'LIVE' }),
      ).toThrow();
      expect(() => loadConfig({ SF_ENVIRONMENT: 'MARS' })).toThrow();
      expect(
        loadConfig({ SF_ENVIRONMENT: 'PRODUCTION', SF_CMP011_DIGILOCKER_MODE: 'OFF' })
          .digiLockerMode,
      ).toBe('OFF');
      expect(loadConfig({}).environment).toBe('LOCAL');
      const prod = Fastify({ logger: false });
      await expect(
        registerEvidence(prod, {
          pool: createMemoryPool(store),
          resolveContext: fixtureResolver,
          bindingPins: pins,
          config: { ...loadConfig({ SF_ENVIRONMENT: 'CI' }), environment: 'PRODUCTION' },
          digiLockerBinding: { ...dlBinding(), environment: 'PRODUCTION' },
        }),
      ).rejects.toThrow();
      const prodNull = Fastify({ logger: false });
      await expect(
        registerEvidence(prodNull, {
          pool: createMemoryPool(store),
          resolveContext: fixtureResolver,
          bindingPins: pins,
          config: { ...loadConfig({ SF_ENVIRONMENT: 'CI' }), environment: 'PRODUCTION' },
          digiLockerBinding: dlBinding(null),
        }),
      ).rejects.toThrow();
      const off = Fastify({ logger: false });
      await expect(
        registerEvidence(off, {
          pool: createMemoryPool(store),
          resolveContext: fixtureResolver,
          bindingPins: pins,
          config: { ...loadConfig({ SF_ENVIRONMENT: 'CI' }), digiLockerMode: 'OFF' },
          digiLockerBinding: dlBinding(),
        }),
      ).rejects.toThrow();
    });

    it('refuses non-SIMULATED, cross-tenant or malformed DigiLocker bindings per request', async () => {
      const pinned = await publishPolicy('t1');
      pins.set(T1, BINDING_ID, { ...pinned, binding_status: 'PUBLISHED' });
      const body = {
        ...baseBody,
        subject_id: SUBJECT,
        digilocker: {
          purpose_code: 'EVIDENCE_LOOKUP',
          scenario: 'all_available',
          test_run_id: 'r',
        },
      };
      const wrongTenant = await build({ digiLockerBinding: dlBinding(T2) });
      const res = await wrongTenant.inject({
        method: 'POST',
        url: '/v1/evidence-requirements/calculate',
        headers: headers('t1', 'w-1'),
        payload: body,
      });
      expect(res.json().error_code).toBe('SF-TEN-002');
      await wrongTenant.close();
      const real = Fastify({ logger: false });
      await expect(
        registerEvidence(real, {
          pool: createMemoryPool(store),
          resolveContext: fixtureResolver,
          bindingPins: pins,
          config: loadConfig({ SF_ENVIRONMENT: 'CI' }),
          digiLockerBinding: {
            ...dlBinding(T1, 'REAL'),
            environment: 'UAT',
            secret_ref: null,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('simulated adapter', () => {
    it('stamps a valid SimulationMarker and refuses non-simulation environments', async () => {
      const adapter = new SimulatedDigiLockerEvidenceAdapter({
        environment: 'SIT',
        connectorBindingId: DL_BINDING_ID,
        clock: () => new Date(NOW),
      });
      const out = await adapter.lookupDocuments({
        subject_id: SUBJECT,
        document_type_refs: ['DL-TYPE-A'],
        scenario: 'all_available',
        test_run_id: 'r1',
      });
      expect(out.simulation.simulation).toBe(true);
      expect(out.documents[0]?.evidence_ref).toBe('sim:r1:DL-TYPE-A');
      const prod = new SimulatedDigiLockerEvidenceAdapter({
        environment: 'PRODUCTION',
        connectorBindingId: DL_BINDING_ID,
      });
      await expect(
        prod.lookupDocuments({
          subject_id: SUBJECT,
          document_type_refs: [],
          scenario: 'all_available',
          test_run_id: 'r1',
        }),
      ).rejects.toThrow();
      await expect(
        adapter.lookupDocuments({
          subject_id: SUBJECT,
          document_type_refs: [],
          scenario: 'all_available',
          test_run_id: ' ',
        }),
      ).rejects.toThrow();
    });

    it('refuses to run inside an open DB transaction', async () => {
      const { runWithTxnFlag } = await import('../../src/domain/txn-guard.js');
      const adapter = new SimulatedDigiLockerEvidenceAdapter({
        environment: 'CI',
        connectorBindingId: DL_BINDING_ID,
      });
      await expect(
        runWithTxnFlag(() =>
          adapter.lookupDocuments({
            subject_id: SUBJECT,
            document_type_refs: [],
            scenario: 'all_available',
            test_run_id: 'r',
          }),
        ),
      ).rejects.toMatchObject({ details: [{ code: 'OUTBOUND_IN_TX' }] });
    });
  });

  it('rate limits per client', async () => {
    const limited = await build({
      config: loadConfig({ SF_ENVIRONMENT: 'CI', SF_CMP011_RATE_LIMIT_MAX: '2' }),
    });
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await limited.inject({
        method: 'GET',
        url: `/v1/evidence-policies/${randomUUID()}`,
        headers: headers('t1'),
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([404, 404, 429, 429]);
    await limited.close();
  });
});
