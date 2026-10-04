import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerRules } from '../../src/plugin.js';
import {
  DenyRulePackPort,
  failingRulePackPort,
  SimulatedRulePackPort,
  type RulePackPort,
} from '../../src/ports/rule-pack.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { criteriaTable, forbiddenNodeGraph, packFixture, pinOf } from '../fixtures/packs.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRACE = '0af7651916cd43dd8448eb211c80319c';

function ctx(tenant: string): RequestContext {
  return {
    tenant_id: tenant,
    actor: { type: 'OFFICER', id: ACTOR },
    cell_id: 'cell-01',
    roles: ['CASE_OFFICER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

const auth = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  ...extra,
});
const key = () => `idem-${randomUUID().slice(0, 12)}`;

interface Harness {
  app: FastifyInstance;
  store: MemoryStore;
  authorizer: ContractAuthorizer;
  packs: SimulatedRulePackPort;
}

async function build(
  overrides: { rulePacks?: RulePackPort; env?: Record<string, string> } = {},
): Promise<Harness> {
  fixtures.clear();
  fixtures.set('t1', ctx(T1));
  fixtures.set('t2', ctx(T2));
  const config = loadConfig({
    SF_ENVIRONMENT: 'LOCAL',
    SF_CMP008_PACK_SOURCE_MODE: 'SIMULATED',
    ...overrides.env,
  });
  const store = emptyStore();
  const authorizer = new ContractAuthorizer();
  const packs = new SimulatedRulePackPort(
    loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_CMP008_PACK_SOURCE_MODE: 'SIMULATED' }),
  );
  const app = Fastify({ logger: false });
  await registerRules(app, {
    pool: createMemoryPool(store),
    resolveContext: fixtureResolver,
    authorizer,
    rulePacks: overrides.rulePacks ?? packs,
    config,
    clock: () => new Date('2026-10-04T12:00:00.000Z'),
  });
  return { app, store, authorizer, packs };
}

function post(h: Harness, token: string, body: unknown, headers: Record<string, string> = {}) {
  return h.app.inject({
    method: 'POST',
    url: '/v1/evaluations',
    headers: auth(token, { 'idempotency-key': key(), ...headers }),
    payload: body as object,
  });
}

const request = (pack: ReturnType<typeof packFixture>, score = 75) => ({
  rule_pack: pinOf(pack),
  inputs: { score },
  purpose_code: 'ELIGIBILITY_CHECK',
  subject_ref: 'case-0001',
});

describe('CMP-008 plugin HTTP (memory pool, real ZEN engine)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });

  it('evaluates a pinned published pack and returns deterministic reason codes', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    const res = await post(h, 't1', request(pack));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.outcome).toBe('MEETS_CRITERIA');
    expect(body.result_code).toBe('RULE_OUTPUT_PRODUCED');
    expect(body.reason_codes).toEqual(['ALPHA_THRESHOLD_MET', 'ZETA_THRESHOLD_MET']);
    expect(body.matched_rules).toEqual([{ node_id: 't', rule_id: 'rule-high' }]);
    expect(body.rule_pack).toEqual(pinOf(pack));
    expect(body.decision_basis).toBe('DETERMINISTIC_RULES');
    expect(body.engine).toEqual({ name: 'gorules-zen', version: '2.0.2' });
    expect(body.simulation.simulation).toBe(true);
    expect(body.input_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(h.store.evaluations)).not.toContain('"score"');
    expect(h.store.outbox.length).toBe(2);
    expect(h.store.snapshots).toHaveLength(1);
  });

  it('gives identical outputs, codes and hashes for identical pinned requests', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    const a = (await post(h, 't1', request(pack))).json();
    const b = (await post(h, 't1', request(pack))).json();
    for (const k of [
      'outcome',
      'result_code',
      'reason_codes',
      'outputs',
      'matched_rules',
      'input_hash',
    ]) {
      expect(b[k]).toEqual(a[k]);
    }
    expect(b.evaluation_id).not.toBe(a.evaluation_id);
    expect(h.store.snapshots).toHaveLength(1);
  });

  it('replays the stored response for the same idempotency key and rejects a changed body', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    const headers = { 'idempotency-key': 'fixed-key-1' };
    const first = await post(h, 't1', request(pack), headers);
    const replay = await post(h, 't1', request(pack), headers);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().evaluation_id).toBe(first.json().evaluation_id);
    expect(h.store.evaluations).toHaveLength(1);
    const conflict = await post(h, 't1', request(pack, 5), headers);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error_code).toBe('SF-APP-002');
  });

  it('reads an evaluation back only within the caller tenant', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    const created = (await post(h, 't1', request(pack))).json();
    const mine = await h.app.inject({
      method: 'GET',
      url: `/v1/evaluations/${created.evaluation_id}`,
      headers: auth('t1'),
    });
    expect(mine.statusCode).toBe(200);
    const theirs = await h.app.inject({
      method: 'GET',
      url: `/v1/evaluations/${created.evaluation_id}`,
      headers: auth('t2'),
    });
    expect(theirs.statusCode).toBe(404);
    expect(theirs.body).not.toContain('MEETS_CRITERIA');
    const bad = await h.app.inject({
      method: 'GET',
      url: '/v1/evaluations/nope',
      headers: auth('t1'),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('denies wrong-tenant pack resolution (tenant 2 cannot use tenant 1 pack)', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    const res = await post(h, 't2', request(pack));
    expect(res.statusCode).toBe(404);
    expect(h.store.evaluations).toHaveLength(0);
  });

  it('denies a port that returns another tenant pack (defence in depth)', async () => {
    const pack = packFixture(T2);
    const leaky: RulePackPort = {
      resolve: async () => ({ ...pack, status: 'PUBLISHED' as const }),
    };
    const hh = await build({ rulePacks: leaky });
    const res = await post(hh, 't1', request(pack));
    expect(res.statusCode).toBe(403);
    expect(res.json().error_code).toBe('SF-TEN-002');
    expect(hh.store.evaluations).toHaveLength(0);
  });

  it('fails closed on pin mismatch, draft status and non-published payloads', async () => {
    const pack = packFixture(T1);
    const mismatch: RulePackPort = {
      resolve: async () => ({
        ...pack,
        content_hash: `sha256:${'0'.repeat(64)}`,
        status: 'PUBLISHED' as const,
      }),
    };
    const hh = await build({ rulePacks: mismatch });
    const res = await post(hh, 't1', request(pack));
    expect(res.statusCode).toBe(422);
    expect(res.json().details[0].code).toBe('RULE_PACK_PIN_MISMATCH');
    const draft: RulePackPort = {
      resolve: async () => ({ ...pack, status: 'DRAFT' as unknown as 'PUBLISHED' }),
    };
    const hd = await build({ rulePacks: draft });
    expect((await post(hd, 't1', request(pack))).statusCode).toBe(422);
  });

  it('rejects packs whose graph is not deterministic metadata', async () => {
    const bad = packFixture(T1, forbiddenNodeGraph('functionNode'));
    h.packs.publish(bad);
    const res = await post(h, 't1', request(bad));
    expect(res.statusCode).toBe(422);
    expect(res.json().details[0].code).toBe('JDM_NODE_TYPE_FORBIDDEN');
    expect(h.store.evaluations).toHaveLength(0);
  });

  it('rejects invalid outcome and reason code values from a pack', async () => {
    const badOutcome = packFixture(T1, criteriaTable(), { outcome_field: 'reasons' });
    h.packs.publish(badOutcome);
    const res = await post(h, 't1', request(badOutcome));
    expect(res.statusCode).toBe(422);
    expect(res.json().details[0].code).toBe('OUTCOME_VALUE_INVALID');
    const badReason = packFixture(T1, criteriaTable(), {
      reason_codes_field: 'outcome',
      outcome_field: undefined,
    });
    badReason.payload = {
      ...(badReason.payload as object),
      outcome_field: undefined,
      reason_codes_field: 'unknown_field',
    };
    h.packs.publish(badReason);
    const ok = await post(h, 't1', request(badReason));
    expect(ok.json().reason_codes).toEqual([]);
  });

  it('denies unauthorized callers and fails closed when the PDP is down', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    h.authorizer.denies.add('RULE_EVALUATION_EXECUTE');
    const denied = await post(h, 't1', request(pack));
    expect(denied.statusCode).toBe(403);
    expect(h.store.evaluations).toHaveLength(0);
    h.authorizer.denies.clear();
    h.authorizer.throws = true;
    expect((await post(h, 't1', request(pack))).statusCode).toBe(503);
    h.authorizer.throws = false;
    h.authorizer.denies.add('RULE_EVALUATION_READ');
    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/evaluations/${randomUUID()}`,
      headers: auth('t1'),
    });
    expect(read.statusCode).toBe(403);
  });

  it('requires authentication and rejects tenant-identifying headers', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    const anon = await h.app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: { 'idempotency-key': key() },
      payload: request(pack),
    });
    expect(anon.statusCode).toBe(401);
    const spoof = await post(h, 't1', request(pack), { 'x-tenant-id': T2 });
    expect(spoof.statusCode).toBe(403);
    const forwarded = await post(h, 't1', request(pack), { forwarded: `for=1.1.1.1;tenant=${T2}` });
    expect(forwarded.statusCode).toBe(403);
    const noTenant = ctx(T1);
    fixtures.set('plat', { ...noTenant, tenant_id: null });
    expect((await post(h, 'plat', request(pack))).statusCode).toBe(401);
  });

  it('validates the request body and idempotency key', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    const base = request(pack);
    const cases: [string, unknown][] = [
      ['BODY_FIELD_UNKNOWN', { ...base, extra: 1 }],
      ['RULE_PACK_REQUIRED', { ...base, rule_pack: undefined }],
      ['RULE_PACK_FIELD_UNKNOWN', { ...base, rule_pack: { ...base.rule_pack, x: 1 } }],
      ['PACK_KEY_INVALID', { ...base, rule_pack: { ...base.rule_pack, pack_key: 'Bad Key' } }],
      ['VERSION_ID_INVALID', { ...base, rule_pack: { ...base.rule_pack, version_id: 'x' } }],
      ['CONTENT_HASH_INVALID', { ...base, rule_pack: { ...base.rule_pack, content_hash: 'x' } }],
      ['PURPOSE_CODE_INVALID', { ...base, purpose_code: 'lower' }],
      ['INPUTS_REQUIRED', { ...base, inputs: [] }],
      ['SUBJECT_REF_INVALID', { ...base, subject_ref: 'has space' }],
      ['INPUTS_KEY_FORBIDDEN', { ...base, inputs: { nested: { constructor: 1 } } }],
      [
        'INPUTS_TOO_DEEP',
        { ...base, inputs: JSON.parse('{"a":'.repeat(14) + '1' + '}'.repeat(14)) },
      ],
      ['INPUTS_TOO_LARGE', { ...base, inputs: { blob: 'x'.repeat(70_000) } }],
    ];
    for (const [code, body] of cases) {
      const res = await post(h, 't1', body);
      expect(res.statusCode, code).toBe(400);
      expect(res.json().details[0].code, code).toBe(code);
    }
    const poisoned = await h.app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1', { 'idempotency-key': key(), 'content-type': 'application/json' }),
      payload: JSON.stringify({ ...base, inputs: JSON.parse('{"__proto__":{"a":1}}') }),
    });
    expect(poisoned.statusCode).toBe(400);
    const noKey = await h.app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1'),
      payload: base,
    });
    expect(noKey.statusCode).toBe(400);
    const notObject = await h.app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1', { 'idempotency-key': key(), 'content-type': 'application/json' }),
      payload: '[1]',
    });
    expect(notObject.statusCode).toBe(400);
  });

  it('fails closed when the published-pack source is down or denies', async () => {
    const pack = packFixture(T1);
    const down = await build({ rulePacks: failingRulePackPort() });
    expect((await post(down, 't1', request(pack))).statusCode).toBe(503);
    const deny = await build({ rulePacks: new DenyRulePackPort() });
    expect((await post(deny, 't1', request(pack))).statusCode).toBe(503);
    const defaulted = Fastify({ logger: false });
    await registerRules(defaulted, {
      pool: createMemoryPool(emptyStore()),
      resolveContext: fixtureResolver,
      authorizer: new ContractAuthorizer(),
      config: loadConfig({}),
    });
    const res = await defaulted.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1', { 'idempotency-key': key() }),
      payload: request(pack),
    });
    expect(res.statusCode).toBe(503);
  });

  it('refuses SIMULATED packs in PRODUCTION and a missing evaluation', async () => {
    const pack = packFixture(T1);
    const sim = h.packs;
    sim.publish(pack);
    const prod = await build({
      rulePacks: sim,
      env: { SF_ENVIRONMENT: 'PRODUCTION', SF_CMP008_PACK_SOURCE_MODE: 'OFF' },
    });
    const res = await post(prod, 't1', request(pack));
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].code).toBe('PRODUCTION_SIMULATED_FORBIDDEN');
    const missing = await h.app.inject({
      method: 'GET',
      url: `/v1/evaluations/${randomUUID()}`,
      headers: auth('t1'),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('refuses a stored snapshot whose digest differs (published pack mutated upstream)', async () => {
    const pack = packFixture(T1);
    h.packs.publish(pack);
    await post(h, 't1', request(pack));
    const first = h.store.snapshots[0];
    if (first) first.payload_digest = `sha256:${'f'.repeat(64)}`;
    const res = await post(h, 't1', request(pack));
    expect(res.statusCode).toBe(422);
    expect(res.json().details[0].code).toBe('RULE_PACK_DIGEST_MISMATCH');
  });
});
