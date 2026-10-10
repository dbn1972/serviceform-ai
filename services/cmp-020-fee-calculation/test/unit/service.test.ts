import { describe, expect, it } from 'vitest';
import { createFeeApi } from '../../src/api/handler.js';
import { buildFeeService } from '../../src/index.js';
import type { FeeRepository, FeeTx } from '../../src/repo/types.js';
import { CLIENT_AUTHORITY_KEYS } from '../../src/service/input.js';
import {
  ACTOR_OFFICER,
  AllowAllAuthorizer,
  APPLICATION_ID,
  APPLICATION_NO_FEE_PIN,
  ctxFor,
  FEE_POLICY_FIXED,
  FEE_POLICY_RULES,
  fixedPolicy,
  OTHER_RULE_VERSION,
  RULE_VERSION,
  TENANT_A,
  TENANT_B,
  TSB_ID,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';
import { MemoryFeeRepository } from '../doubles/memory-repo.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const QUOTES = '/v1/fee-quotes';

function useRules(h: Harness): void {
  h.pins.pinPolicy(FEE_POLICY_RULES);
}

function errCode(body: unknown): string | undefined {
  return (body as Body)['details']?.[0]?.code as string | undefined;
}

describe('POST /v1/fee-quotes: deterministic quote from governed pins', () => {
  it('issues a quote from the pinned published fee policy (metadata only)', async () => {
    const h = makeHarness();
    const res = await h.call(
      'POST',
      QUOTES,
      { application_id: APPLICATION_ID },
      { key: 'quote-key-0001' },
    );
    expect(res.status).toBe(201);
    const q = res.body as Body;
    expect(q).toMatchObject({
      contract_id: 'SF-CON-FEE-QUOTE',
      tenant_id: TENANT_A,
      application_id: APPLICATION_ID,
      currency: 'XTS',
      total_amount_minor: 13023,
      amount_source: 'FEE_POLICY_METADATA',
      client_authoritative_amount: false,
      fee_policy_version_id: FEE_POLICY_FIXED,
      rule_version_id: RULE_VERSION,
      tenant_service_binding_id: TSB_ID,
      idempotency_key: 'quote-key-0001',
    });
    expect(q['line_items']).toEqual([
      {
        code: 'SYNTHETIC_LINE_A',
        amount_minor: 12345,
        calculation_basis: 'FEE_POLICY_LINE',
        description_code: 'SYN_A',
      },
      { code: 'SYNTHETIC_LINE_B', amount_minor: 678, calculation_basis: 'FEE_POLICY_LINE' },
    ]);
    expect(q['waiver_policy_ref']).toBeUndefined();
    expect(h.rules.calls).toHaveLength(0);
    expect(h.probe.violations).toBe(0);
  });

  it('takes rule-line amounts from the pinned CMP-008 rule version and passes waiver ref through', async () => {
    const h = makeHarness();
    useRules(h);
    const res = await h.call('POST', QUOTES, {
      application_id: APPLICATION_ID,
      facts: { category_code: 'SYN_CAT', unit_count: 3 },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount_source: 'RULES_ENGINE',
      total_amount_minor: 3000,
      waiver_policy_ref: 'synthetic-waiver-policy-ref',
      fee_policy_version_id: FEE_POLICY_RULES,
    });
    expect(h.rules.calls).toHaveLength(1);
    expect(h.rules.calls[0]).toMatchObject({
      rule_version_id: RULE_VERSION,
      purpose_code: 'FEE_CALCULATION',
      application_id: APPLICATION_ID,
      facts: { category_code: 'SYN_CAT', unit_count: 3 },
    });
    expect(h.rules.calls[0]?.idempotency_key).toMatch(/^cmp020\.[0-9a-f]{48}$/);
    expect(h.probe.violations).toBe(0);
  });

  it('replays the same key without re-invoking ports or duplicating effects', async () => {
    const h = makeHarness();
    useRules(h);
    const body = { application_id: APPLICATION_ID, facts: { category_code: 'A' } };
    const first = await h.call('POST', QUOTES, body, { key: 'replay-key-01' });
    const second = await h.call('POST', QUOTES, body, { key: 'replay-key-01' });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(h.rules.calls).toHaveLength(1);
    expect(h.policies.calls).toBe(1);
    expect(h.pins.calls).toBe(1);
    expect(h.repo.tenant(TENANT_A).quotes.size).toBe(1);
    expect(h.repo.tenant(TENANT_A).outbox).toHaveLength(2);
  });

  it('refuses the same key with a different body (SF-APP-002)', async () => {
    const h = makeHarness();
    await h.call('POST', QUOTES, { application_id: APPLICATION_ID }, { key: 'conflict-key-1' });
    const res = await h.call(
      'POST',
      QUOTES,
      { application_id: APPLICATION_ID, facts: { category_code: 'B' } },
      { key: 'conflict-key-1' },
    );
    expect(res.status).toBe(409);
    expect((res.body as Body)['error_code']).toBe('SF-APP-002');
  });

  it('identical governed inputs under a new key return the same immutable quote', async () => {
    const h = makeHarness();
    useRules(h);
    const body = { application_id: APPLICATION_ID, facts: { category_code: 'A' } };
    const first = await h.call('POST', QUOTES, body, { key: 'det-key-0001' });
    const second = await h.call('POST', QUOTES, body, { key: 'det-key-0002' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as Body)['quote_id']).toBe((first.body as Body)['quote_id']);
    expect(h.repo.tenant(TENANT_A).quotes.size).toBe(1);
    expect(h.repo.tenant(TENANT_A).outbox).toHaveLength(2);
  });

  it('changed rule facts produce a new quote; facts are ignored when no rule line exists', async () => {
    const h = makeHarness();
    useRules(h);
    await h.call('POST', QUOTES, { application_id: APPLICATION_ID, facts: { category_code: 'A' } });
    h.rules.outputs = { line_amount_minor: 4000 };
    const changed = await h.call('POST', QUOTES, {
      application_id: APPLICATION_ID,
      facts: { category_code: 'B' },
    });
    expect(changed.status).toBe(201);
    expect((changed.body as Body)['total_amount_minor']).toBe(4500);
    expect(h.repo.tenant(TENANT_A).quotes.size).toBe(2);

    const f = makeHarness();
    const a = await f.call('POST', QUOTES, {
      application_id: APPLICATION_ID,
      facts: { category_code: 'A' },
    });
    const b = await f.call('POST', QUOTES, {
      application_id: APPLICATION_ID,
      facts: { category_code: 'B' },
    });
    expect(b.status).toBe(200);
    expect((b.body as Body)['quote_id']).toBe((a.body as Body)['quote_id']);
  });

  it('emits exactly one FeeQuoteIssued and one audit event without rule facts', async () => {
    const h = makeHarness();
    useRules(h);
    const canary = 'CANARY-FACT-VALUE-9f2a';
    await h.call('POST', QUOTES, {
      application_id: APPLICATION_ID,
      facts: { category_code: canary },
    });
    const outbox = h.repo.tenant(TENANT_A).outbox;
    expect(outbox.map((o) => [o.topic, o.envelope.event_type])).toEqual([
      ['sf.fee.events.v1', 'FeeQuoteIssued'],
      ['sf.audit.ingest.v1', 'AuditEventSubmitted'],
    ]);
    expect(JSON.stringify(outbox)).not.toContain(canary);
    expect(
      JSON.stringify([...h.repo.tenant(TENANT_A).quotes.values()], (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ).not.toContain(canary);
    expect(outbox[0]?.envelope.data).toMatchObject({
      total_amount_minor: 3000,
      client_authoritative_amount: false,
    });
  });
});

describe('client authority is refused', () => {
  it.each([...CLIENT_AUTHORITY_KEYS])('refuses body key %s', async (key) => {
    const h = makeHarness();
    const res = await h.call('POST', QUOTES, { application_id: APPLICATION_ID, [key]: 1 });
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('CLIENT_AMOUNT_FORBIDDEN');
    expect(h.pins.calls).toBe(0);
  });

  it.each([
    'fee_amount',
    'total_due',
    'waiver_flag',
    'is_exempt',
    'discount_pct',
    'charge',
    'price_band',
  ])('refuses outcome-like fact key %s', async (key) => {
    const h = makeHarness();
    const res = await h.call('POST', QUOTES, {
      application_id: APPLICATION_ID,
      facts: { [key]: 0 },
    });
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('CLIENT_AMOUNT_FORBIDDEN');
  });

  it.each([
    ['unknown field', { application_id: APPLICATION_ID, extra: 1 }, 'UNKNOWN_FIELD'],
    ['missing application', {}, 'UUID_REQUIRED'],
    ['bad application id', { application_id: 'x' }, 'UUID_REQUIRED'],
    ['array facts', { application_id: APPLICATION_ID, facts: [] }, 'FACTS_OBJECT_REQUIRED'],
    [
      'bad fact key',
      { application_id: APPLICATION_ID, facts: { 'Bad-Key': 1 } },
      'FACT_KEY_INVALID',
    ],
    [
      'non-finite fact',
      { application_id: APPLICATION_ID, facts: { n: Number.POSITIVE_INFINITY } },
      'FACT_VALUE_INVALID',
    ],
    [
      'deep fact',
      { application_id: APPLICATION_ID, facts: { n: { a: { b: { c: { d: 1 } } } } } },
      'FACT_VALUE_INVALID',
    ],
    [
      'too many facts',
      {
        application_id: APPLICATION_ID,
        facts: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 1])),
      },
      'FACTS_TOO_MANY',
    ],
    [
      'oversized facts',
      { application_id: APPLICATION_ID, facts: { blob: 'x'.repeat(17_000) } },
      'FACTS_TOO_LARGE',
    ],
    [
      'client time',
      { application_id: APPLICATION_ID, issued_at: '2026-01-01T00:00:00Z' },
      'CLIENT_TIME_NOT_AUTHORITATIVE',
    ],
    ['non-object body', 'text', 'BODY_OBJECT_REQUIRED'],
  ])('refuses %s', async (_label, body, code) => {
    const h = makeHarness();
    const res = await h.call('POST', QUOTES, body);
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe(code);
  });
});

describe('governed pin failures fail closed with no persistence', () => {
  async function expectRefused(
    h: Harness,
    status: number,
    errorCode: string,
    detailCode: string,
  ): Promise<void> {
    const res = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    expect(res.status).toBe(status);
    expect((res.body as Body)['error_code']).toBe(errorCode);
    expect(errCode(res.body)).toBe(detailCode);
    expect(h.repo.tenant(TENANT_A).quotes.size).toBe(0);
    expect(h.repo.tenant(TENANT_A).outbox).toHaveLength(0);
    expect(h.repo.tenant(TENANT_A).idempotency.size).toBe(0);
    expect(h.probe.violations).toBe(0);
  }

  it('no fee policy pinned on the application: no default amount is invented', async () => {
    const h = makeHarness();
    const res = await h.call('POST', QUOTES, { application_id: APPLICATION_NO_FEE_PIN });
    expect(res.status).toBe(409);
    expect(errCode(res.body)).toBe('FEE_POLICY_NOT_PINNED');
    expect(h.policies.calls).toBe(0);
  });

  it('unknown application', async () => {
    const h = makeHarness();
    const res = await h.call('POST', QUOTES, {
      application_id: '33333333-3333-4333-8333-333333333399',
    });
    expect(res.status).toBe(404);
    expect(errCode(res.body)).toBe('APPLICATION_NOT_FOUND');
  });

  it('pins port returns a different application', async () => {
    const h = makeHarness();
    h.pins.getFeePins = () =>
      Promise.resolve({
        application_id: APPLICATION_NO_FEE_PIN,
        tenant_service_binding_id: TSB_ID,
        rule_version_id: RULE_VERSION,
        fee_policy_version_id: FEE_POLICY_FIXED,
      });
    await expectRefused(h, 404, 'SF-SYS-002', 'APPLICATION_NOT_FOUND');
  });

  it('malformed pins', async () => {
    const h = makeHarness();
    h.pins.set(TENANT_A, {
      application_id: APPLICATION_ID,
      tenant_service_binding_id: 'x',
      rule_version_id: RULE_VERSION,
      fee_policy_version_id: FEE_POLICY_FIXED,
    });
    await expectRefused(h, 409, 'SF-FORM-001', 'APPLICATION_PINS_INVALID');
  });

  it('pinned version not found', async () => {
    const h = makeHarness();
    h.policies.versions.delete(FEE_POLICY_FIXED);
    await expectRefused(h, 409, 'SF-FORM-001', 'FEE_POLICY_VERSION_NOT_FOUND');
  });

  it('pinned version is a draft', async () => {
    const h = makeHarness();
    h.policies.versions.set(FEE_POLICY_FIXED, fixedPolicy({ publication_status: 'DRAFT' }));
    await expectRefused(h, 409, 'SF-FORM-001', 'FEE_POLICY_NOT_PUBLISHED');
  });

  it('policy declares a rule version other than the application pin', async () => {
    const h = makeHarness();
    h.policies.versions.set(FEE_POLICY_FIXED, fixedPolicy({ rule_version_id: OTHER_RULE_VERSION }));
    await expectRefused(h, 409, 'SF-FORM-001', 'RULE_VERSION_PIN_MISMATCH');
  });

  it('rules evaluated against an unpinned version', async () => {
    const h = makeHarness();
    useRules(h);
    h.rules.overrides = {
      rule_pack: { version_id: OTHER_RULE_VERSION, content_hash: `sha256:${'c'.repeat(64)}` },
    };
    await expectRefused(h, 422, 'SF-RULE-001', 'RULE_VERSION_MISMATCH');
  });

  it.each([
    ['fractional rule output', { line_amount_minor: 12.75 }, 'RULE_OUTPUT_NOT_INTEGER_MINOR'],
    ['missing rule output', {}, 'RULE_OUTPUT_MISSING'],
  ])('%s', async (_label, outputs, code) => {
    const h = makeHarness();
    useRules(h);
    h.rules.outputs = outputs;
    await expectRefused(h, 422, 'SF-RULE-001', code);
  });

  it('rules engine produced no output', async () => {
    const h = makeHarness();
    useRules(h);
    h.rules.overrides = { result_code: 'NO_RULE_OUTPUT' };
    await expectRefused(h, 422, 'SF-RULE-001', 'NO_RULE_OUTPUT');
  });

  it.each([
    ['pins', 'APPLICATION_PINS_UNAVAILABLE'],
    ['policy', 'FEE_POLICY_UNAVAILABLE'],
    ['rules', 'FEE_RULES_UNAVAILABLE'],
  ])('%s port outage maps to SF-SYS-004', async (port, code) => {
    const h = makeHarness();
    useRules(h);
    const boom = new Error('connection reset');
    if (port === 'pins') h.pins.failure = boom;
    if (port === 'policy') h.policies.failure = boom;
    if (port === 'rules') h.rules.failure = boom;
    await expectRefused(h, 503, 'SF-SYS-004', code);
  });

  it('unbound ports fail closed; there is no default fee', async () => {
    const repo = new MemoryFeeRepository();
    const service = buildFeeService({ repository: repo, authorizer: new AllowAllAuthorizer() });
    const api = createFeeApi({ service, resolveContext: () => Promise.resolve(ctxFor(TENANT_A)) });
    const res = await api.handle({
      method: 'POST',
      path: QUOTES,
      headers: { 'idempotency-key': 'unbound-key-1' },
      body: { application_id: APPLICATION_ID },
    });
    expect(res.status).toBe(503);
    expect(errCode(res.body)).toBe('APPLICATION_PINS_PORT_NOT_BOUND');
    expect(repo.tenant(TENANT_A).quotes.size).toBe(0);
  });

  it('a repository is required', () => {
    expect(() => buildFeeService({ authorizer: new AllowAllAuthorizer() })).toThrow();
  });
});

describe('authorization and tenant isolation', () => {
  it('OPA deny stops before any port call or write', async () => {
    const h = makeHarness();
    h.authorizer.mode = 'deny';
    const res = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    expect(res.status).toBe(403);
    expect((res.body as Body)['error_code']).toBe('SF-AUTH-002');
    expect(h.pins.calls).toBe(0);
    expect(h.repo.txCount).toBe(0);
  });

  it('PDP outage fails closed', async () => {
    const h = makeHarness();
    h.authorizer.mode = 'throw';
    const res = await h.call('GET', `/v1/applications/${APPLICATION_ID}/fee-quotes`, undefined, {
      key: null,
    });
    expect(res.status).toBe(503);
    expect(errCode(res.body)).toBe('PDP_UNAVAILABLE');
  });

  it('sends tenant-scoped authorization input with the application resource', async () => {
    const h = makeHarness();
    await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    expect(h.authorizer.calls[0]).toMatchObject({
      action: 'FEE_QUOTE_CREATE',
      subject: { tenant_id: TENANT_A },
      resource: { resource_type: 'FeeQuote', tenant_id: TENANT_A, application_id: APPLICATION_ID },
    });
  });

  it('refuses actor types outside citizen/officer/system', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_OFFICER, 'INTEGRATION');
    const res = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    expect(res.status).toBe(403);
    expect(errCode(res.body)).toBe('ACTOR_NOT_PERMITTED');
  });

  it('officer and system actors may request quotes', async () => {
    for (const type of ['OFFICER', 'SYSTEM'] as const) {
      const h = makeHarness();
      h.state.ctx = ctxFor(TENANT_A, ACTOR_OFFICER, type);
      expect((await h.call('POST', QUOTES, { application_id: APPLICATION_ID })).status).toBe(201);
    }
  });

  it("wrong tenant cannot read, list, or quote another tenant's application", async () => {
    const h = makeHarness();
    const created = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    const quoteId = (created.body as Body)['quote_id'] as string;
    h.state.ctx = ctxFor(TENANT_B);
    const read = await h.call('GET', `${QUOTES}/${quoteId}`, undefined, { key: null });
    expect(read.status).toBe(404);
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/fee-quotes`, undefined, {
      key: null,
    });
    expect(list.status).toBe(200);
    expect((list.body as Body)['quotes']).toEqual([]);
    const quote = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    expect(quote.status).toBe(404);
    expect(JSON.stringify([read.body, list.body, quote.body])).not.toContain(quoteId);
  });

  it('a fee policy owned by another tenant is a cross-tenant denial', async () => {
    const h = makeHarness();
    h.pins.set(TENANT_B, {
      application_id: APPLICATION_ID,
      tenant_service_binding_id: TSB_ID,
      rule_version_id: RULE_VERSION,
      fee_policy_version_id: FEE_POLICY_FIXED,
    });
    h.policies.getPublishedVersion = () => Promise.resolve(fixedPolicy());
    h.state.ctx = ctxFor(TENANT_B);
    const res = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    expect(res.status).toBe(403);
    expect((res.body as Body)['error_code']).toBe('SF-TEN-002');
    expect(h.repo.tenant(TENANT_B).quotes.size).toBe(0);
  });

  it.each([
    ['x-tenant-id', TENANT_B],
    ['x-sf-tenant', TENANT_B],
    ['forwarded', `for=1.2.3.4;tenant=${TENANT_B}`],
    ['x-roles', 'admin'],
  ])('refuses tenant/role-identifying header %s', async (name, value) => {
    const h = makeHarness();
    const res = await h.call(
      'POST',
      QUOTES,
      { application_id: APPLICATION_ID },
      { headers: { [name]: value } },
    );
    expect(res.status).toBe(403);
    expect((res.body as Body)['error_code']).toBe('SF-TEN-002');
  });

  it.each([
    ['missing context', null, 401, 'SF-AUTH-001'],
    ['null tenant', { ...ctxFor(TENANT_A), tenant_id: null }, 401, 'SF-TEN-001'],
    [
      'bad actor id',
      { ...ctxFor(TENANT_A), actor: { type: 'CITIZEN' as const, id: 'x' } },
      401,
      'SF-AUTH-001',
    ],
  ])('%s is refused', async (_label, ctx, status, code) => {
    const h = makeHarness();
    h.state.ctx = ctx;
    const res = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    expect(res.status).toBe(status);
    expect((res.body as Body)['error_code']).toBe(code);
  });
});

describe('transaction boundary and atomicity', () => {
  it('a failure inside the transaction leaves no quote, outbox or idempotency row; retry succeeds', async () => {
    const h = makeHarness();
    const failing: FeeRepository = {
      inTransaction: () => h.repo.inTransaction(),
      withTx: <T>(ctx: Parameters<FeeRepository['withTx']>[0], fn: (tx: FeeTx) => Promise<T>) =>
        h.repo.withTx(ctx, (tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === 'insertOutbox') return () => Promise.reject(new Error('disk full'));
                return Reflect.get(target, prop, receiver) as unknown;
              },
            }),
          ),
        ),
    };
    const service = buildFeeService({
      repository: failing,
      authorizer: h.authorizer,
      applicationPins: h.pins,
      feePolicy: h.policies,
      feeRules: h.rules,
      clock: h.clock.now,
    });
    const api = createFeeApi({ service, resolveContext: () => Promise.resolve(ctxFor(TENANT_A)) });
    const req = {
      method: 'POST',
      path: QUOTES,
      headers: { 'idempotency-key': 'atomic-key-01' },
      body: { application_id: APPLICATION_ID },
    };
    const res = await api.handle(req);
    expect(res.status).toBe(500);
    expect(h.repo.tenant(TENANT_A).quotes.size).toBe(0);
    expect(h.repo.tenant(TENANT_A).outbox).toHaveLength(0);
    expect(h.repo.tenant(TENANT_A).idempotency.size).toBe(0);
    const retry = await h.api.handle({ ...req, headers: { 'idempotency-key': 'atomic-key-01' } });
    expect(retry.status).toBe(201);
  });

  it('never calls an external port while a transaction is open', async () => {
    const h = makeHarness();
    useRules(h);
    await h.call('POST', QUOTES, { application_id: APPLICATION_ID, facts: { category_code: 'A' } });
    await h.call('POST', QUOTES, { application_id: APPLICATION_ID, facts: { category_code: 'B' } });
    expect(h.rules.calls).toHaveLength(2);
    expect(h.probe.violations).toBe(0);
  });

  it('refuses to start work from inside an open transaction', async () => {
    const h = makeHarness();
    const res = await h.repo.withTx(ctxFor(TENANT_A), () =>
      h.api.handle({ method: 'GET', path: `${QUOTES}/${APPLICATION_ID}`, headers: {} }),
    );
    expect(res.status).toBe(500);
    expect(errCode(res.body)).toBe('NETWORK_IN_TX');
  });
});

describe('read routes and request hygiene', () => {
  it('reads a quote and lists quotes for the application', async () => {
    const h = makeHarness();
    const created = await h.call('POST', QUOTES, { application_id: APPLICATION_ID });
    const id = (created.body as Body)['quote_id'] as string;
    const read = await h.call('GET', `${QUOTES}/${id}`, undefined, { key: null });
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/fee-quotes`, undefined, {
      key: null,
    });
    expect((list.body as Body)['quotes']).toEqual([created.body]);
    expect(read.headers['cache-control']).toBe('no-store');
  });

  it.each([
    [
      'unknown quote',
      'GET',
      `${QUOTES}/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`,
      undefined,
      null,
      404,
      'SF-SYS-002',
    ],
    ['bad quote id', 'GET', `${QUOTES}/nope`, undefined, null, 400, 'SF-SYS-003'],
    [
      'body on GET',
      'GET',
      `/v1/applications/${APPLICATION_ID}/fee-quotes`,
      { x: 1 },
      null,
      400,
      'SF-SYS-003',
    ],
    ['unknown route', 'GET', '/v1/fees', undefined, null, 404, 'SF-SYS-002'],
    ['wrong method', 'DELETE', QUOTES, undefined, null, 400, 'SF-SYS-003'],
    [
      'missing idempotency key',
      'POST',
      QUOTES,
      { application_id: APPLICATION_ID },
      null,
      400,
      'SF-SYS-003',
    ],
    [
      'malformed idempotency key',
      'POST',
      QUOTES,
      { application_id: APPLICATION_ID },
      'short',
      400,
      'SF-SYS-003',
    ],
  ])('%s', async (_label, method, path, body, key, status, code) => {
    const h = makeHarness();
    const res = await h.call(method, path, body, { key });
    expect(res.status).toBe(status);
    expect((res.body as Body)['error_code']).toBe(code);
  });

  it('refuses client-supplied time in the query string', async () => {
    const h = makeHarness();
    const res = await h.call('GET', `/v1/applications/${APPLICATION_ID}/fee-quotes`, undefined, {
      key: null,
      query: { as_of: '2026-01-01' },
    });
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');
  });

  it('maps database errors without leaking detail', async () => {
    const h = makeHarness();
    for (const [pgCode, status] of [
      ['42501', 403],
      ['23505', 409],
      ['23503', 404],
      ['23514', 400],
      ['XX000', 500],
    ] as const) {
      h.repo.withTx = () =>
        Promise.reject(Object.assign(new Error('internal secret detail'), { code: pgCode }));
      const res = await h.call('GET', `${QUOTES}/${APPLICATION_ID}`, undefined, { key: null });
      expect(res.status).toBe(status);
      expect(JSON.stringify(res.body)).not.toContain('secret');
    }
  });
});
