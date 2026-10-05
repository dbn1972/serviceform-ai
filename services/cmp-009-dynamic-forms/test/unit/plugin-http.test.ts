import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerForms } from '../../src/plugin.js';
import {
  DenyFormDefinitionPort,
  failingFormDefinitionPort,
  SimulatedFormDefinitionPort,
  type FormDefinitionPort,
} from '../../src/ports/form-definition.js';
import { SimulatedLocalizationPort } from '../../src/ports/localization.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { formFixture, pinOf, validData } from '../fixtures/forms.js';
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
  forms: SimulatedFormDefinitionPort;
  loc: SimulatedLocalizationPort;
}

async function build(
  overrides: { forms?: FormDefinitionPort; env?: Record<string, string> } = {},
): Promise<Harness> {
  fixtures.clear();
  fixtures.set('t1', ctx(T1));
  fixtures.set('t2', ctx(T2));
  const config = loadConfig({
    SF_ENVIRONMENT: 'LOCAL',
    SF_CMP009_FORM_SOURCE_MODE: 'SIMULATED',
    SF_CMP009_LOCALIZATION_MODE: 'SIMULATED',
    ...overrides.env,
  });
  const store = emptyStore();
  const authorizer = new ContractAuthorizer();
  const forms = new SimulatedFormDefinitionPort(config);
  const loc = new SimulatedLocalizationPort(config);
  loc.put(T1, 'en', {
    'form.field.given_name': 'Given name',
    'form.field.family_name': 'Family name',
  });
  loc.put(T1, 'hi', {
    'form.field.given_name': 'Pratham naam',
    'form.field.family_name': 'Antim naam',
  });
  const app = Fastify({ logger: false });
  await registerForms(app, {
    pool: createMemoryPool(store),
    resolveContext: fixtureResolver,
    authorizer,
    forms: overrides.forms ?? forms,
    localization: loc,
    config,
    clock: () => new Date('2026-10-04T12:00:00.000Z'),
  });
  return { app, store, authorizer, forms, loc };
}

function post(h: Harness, token: string, body: unknown, headers: Record<string, string> = {}) {
  return h.app.inject({
    method: 'POST',
    url: '/v1/executions',
    headers: auth(token, { 'idempotency-key': key(), ...headers }),
    payload: body as object,
  });
}

describe('CMP-009 plugin HTTP (memory pool)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });

  it('authoritatively validates a pinned published form', async () => {
    const form = formFixture(T1);
    h.forms.publish(form);
    const res = await post(h, 't1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.result_code).toBe('VALID');
    expect(body.client_validation_authoritative).toBe(false);
    expect(body.required_fields).toEqual(['category', 'family_name', 'given_name', 'has_prior']);
    expect(JSON.stringify(h.store.executions)).not.toContain('Lovelace');
  });

  it('rejects missing required fields with SF-FORM-002', async () => {
    const form = formFixture(T1);
    h.forms.publish(form);
    const res = await post(h, 't1', {
      form: pinOf(form),
      data: { given_name: 'Ada', has_prior: false, category: 'ALPHA' },
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error_code).toBe('SF-FORM-002');
    expect(h.store.executions[0]?.result_code).toBe('INVALID');
  });

  it('rejects unpublished forms and version pin mismatches', async () => {
    const form = formFixture(T1);
    h.forms.publish({ ...form, status: 'DRAFT' });
    const unpublished = await post(h, 't1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(unpublished.statusCode).toBe(409);
    expect(unpublished.json().error_code).toBe('SF-FORM-001');

    const published = formFixture(T1);
    h.forms.publish(published);
    const mismatch = await post(h, 't1', {
      form: { ...pinOf(published), content_hash: `sha256:${'ab'.repeat(32)}` },
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(mismatch.statusCode).toBe(409);
  });

  it('rejects malformed metadata payloads', async () => {
    const form = formFixture(T1);
    h.forms.publish({ ...form, payload: { form_id: form.form_key } });
    const res = await post(h, 't1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(res.statusCode).toBe(422);
  });

  it('wrong-tenant cannot execute another tenant pin and CROSS_TENANT_LEAKAGE=0', async () => {
    const form = formFixture(T1);
    h.forms.publish(form);
    const created = await post(h, 't1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    const id = created.json().execution_id as string;
    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/executions/${id}`,
      headers: auth('t2'),
    });
    expect(read.statusCode).toBe(404);
    const useOther = await post(h, 't2', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(useOther.statusCode).toBe(404);
    expect(h.store.executions.filter((e) => e.tenant_id === T2).length).toBe(0);
  });

  it('localizes labels via the CMP-053 port contract', async () => {
    const form = formFixture(T1);
    h.forms.publish(form);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/interpretations',
      headers: auth('t1'),
      payload: { form: pinOf(form), data: validData(), locale: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.client_validation_authoritative).toBe(false);
    const given = (body.controls as { field: string; label: string }[]).find(
      (c) => c.field === 'given_name',
    );
    expect(given?.label).toBe('Pratham naam');
  });

  it('forged tenant headers are denied', async () => {
    const form = formFixture(T1);
    h.forms.publish(form);
    const res = await post(
      h,
      't1',
      {
        form: pinOf(form),
        data: validData(),
        purpose_code: 'FORM_SUBMIT',
        locale: 'en',
      },
      { 'x-tenant-id': T2 },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error_code).toBe('SF-TEN-002');
  });

  it('unauthorized and failing form source fail closed', async () => {
    h.authorizer.denies.add('FORM_EXECUTION_EXECUTE');
    const form = formFixture(T1);
    h.forms.publish(form);
    const denied = await post(h, 't1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(denied.statusCode).toBe(403);
    await h.app.close();
    h = await build({ forms: failingFormDefinitionPort() });
    const down = await post(h, 't1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(down.statusCode).toBe(503);
    await h.app.close();
    h = await build({ forms: new DenyFormDefinitionPort() });
    const deny = await post(h, 't1', {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    });
    expect(deny.statusCode).toBe(503);
  });

  it('replays idempotent executions', async () => {
    const form = formFixture(T1);
    h.forms.publish(form);
    const idem = key();
    const body = {
      form: pinOf(form),
      data: validData(),
      purpose_code: 'FORM_SUBMIT',
      locale: 'en',
    };
    const first = await h.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: auth('t1', { 'idempotency-key': idem }),
      payload: body,
    });
    const second = await h.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: auth('t1', { 'idempotency-key': idem }),
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().execution_id).toBe(first.json().execution_id);
    expect(h.store.executions.length).toBe(1);
  });
});
