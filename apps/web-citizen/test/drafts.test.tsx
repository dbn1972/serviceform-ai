import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as createDraftRoute } from '../app/api/portal/drafts/route';
import { GET as readDraftRoute, PUT as saveDraftRoute } from '../app/api/portal/drafts/[id]/route';
import { ApplicationCard } from '../components/ApplicationCard';
import { applicationStatus } from '../lib/ind-soc-002';
import type { CaseState, PlatformApplication } from '../lib/portal/applications';
import {
  ALREADY_SUBMITTED,
  FORM_CHANGED,
  ownDraft,
  parseDraftSave,
  SAVED_ELSEWHERE,
  sessionKey,
  writeDraftData,
} from '../lib/portal/drafts';
import { applyBody } from '../lib/portal/forms';
import type { Citizen } from '../lib/portal/platform';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const API = 'http://platform.test';
const RESIDENCE_BINDING = '0d15ba00-0002-4000-8000-0d15ba0000d2';
const INCOME_BINDING = '0d15ba31-0002-4000-8000-0d15ba310002';
const RESIDENCE_FORM = '0d15ba00-0010-4000-8000-0d15ba000010';
const CASE_ID = '11111111-2222-4333-8444-555555555555';
const CITIZEN_ID = '99999999-8888-4777-8666-555555555555';
const TOKEN = 'T'.repeat(43);
const KEY = 'a'.repeat(32);
const citizen: Citizen = { token: TOKEN, citizen_id: CITIZEN_ID, assurance: 'OTP' };

type Call = { method: string; path: string; body: unknown; key: string | null };
type Reply = { status: number; body: Record<string, unknown> };

function caseOf(state: CaseState, overrides: Partial<PlatformApplication['pins']> = {}) {
  return {
    application_id: CASE_ID,
    state,
    aggregate_version: 1,
    created_at: '2026-11-24T10:00:00.000Z',
    updated_at: '2026-11-24T10:00:00.000Z',
    submitted_at: null,
    pins: {
      tenant_service_binding_id: RESIDENCE_BINDING,
      form_version_id: RESIDENCE_FORM,
      ...overrides,
    },
  } satisfies PlatformApplication;
}

function workingData(revision: number, hash = `sha256:r${revision}`) {
  return {
    working_data: {
      application_id: CASE_ID,
      revision,
      form_version_id: RESIDENCE_FORM,
      data: { applicant_name: 'SAMPLE Saved' },
      data_hash: hash,
      updated_at: '2026-11-24T10:05:00.000Z',
    },
  };
}

/** Stand-in platform host: routes `${method} ${path}` to a reply and records every call. */
function platformHost(routes: Record<string, Reply | ((call: Call) => Reply)>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace(API, '');
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      key: headers['idempotency-key'] ?? null,
    };
    calls.push(call);
    const route = routes[`${call.method} ${path}`];
    const reply =
      typeof route === 'function'
        ? route(call)
        : (route ?? { status: 404, body: { error_code: 'SF-SYS-002' } });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  return calls;
}

const SIGNED_IN: Record<string, Reply> = {
  'GET /v1/identity/me': {
    status: 200,
    body: { actor_type: 'CITIZEN', subject_id: CITIZEN_ID, assurance: 'OTP' },
  },
};

function browser(method: string, url: string, body?: unknown, key: string | null = KEY) {
  return new Request(`http://127.0.0.1:3000${url}`, {
    method,
    headers: {
      host: '127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      cookie: `sf_citizen_session=${TOKEN}`,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(() => {
  process.env['SF_API_BASE_URL'] = API;
  process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
    ROOT,
    'fixtures/lab/platform/placement.citizen.json',
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// REQ WS1 save-and-resume: CMP-015 DRAFT + working data (CCR-M10-001); CMP-009 stays authoritative.
describe('draft request parsing', () => {
  it('accepts catalogue id, answers and an optional non-negative revision only', () => {
    expect(parseDraftSave({ catalogue_id: 'IND-SOC-002', data: { a: 1 } })).toEqual({
      catalogueId: 'IND-SOC-002',
      data: { a: 1 },
      expectedRevision: null,
    });
    expect(
      parseDraftSave({ catalogue_id: 'X', data: {}, expected_revision: 3 })?.expectedRevision,
    ).toBe(3);
    for (const bad of [
      null,
      [],
      { data: {} },
      { catalogue_id: 'X', data: [] },
      { catalogue_id: 'X', data: {}, expected_revision: -1 },
      { catalogue_id: 'X', data: {}, expected_revision: 1.5 },
      { catalogue_id: 'X', data: {}, expected_revision: '2' },
    ]) {
      expect(parseDraftSave(bad)).toBeNull();
    }
  });

  it('only derives platform keys from a well-formed form-session key', () => {
    expect(sessionKey(KEY)).toBe(KEY);
    expect(sessionKey('short')).toBeNull();
    expect(sessionKey('bad key with spaces!!')).toBeNull();
    expect(sessionKey(null)).toBeNull();
  });

  it('reads a draft id from the apply body without changing bare-object apply', () => {
    expect(
      applyBody({ catalogue_id: 'IND-SOC-002', data: {}, application_id: CASE_ID }).draftId,
    ).toBe(CASE_ID);
    expect(applyBody({ catalogue_id: 'IND-SOC-002', data: {} }).draftId).toBeNull();
    expect(applyBody({ applicant_name: 'SAMPLE' })).toEqual({
      catalogueId: 'IND-SOC-002',
      data: { applicant_name: 'SAMPLE' },
      draftId: null,
    });
  });
});

describe('ownDraft (CMP-015 owner, offering and version checks)', () => {
  const residence = { catalogue_id: 'IND-SOC-002', tenant_service_binding_id: RESIDENCE_BINDING };

  it('NEGATIVE: another citizen’s case (403/404) reads as not found', async () => {
    for (const status of [403, 404]) {
      platformHost({ [`GET /v1/applications/${CASE_ID}`]: { status, body: {} } });
      const out = await ownDraft(citizen, CASE_ID, residence, RESIDENCE_FORM);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.response.status).toBe(404);
    }
  });

  it('NEGATIVE: a draft for another service is not found under this service', async () => {
    platformHost({
      [`GET /v1/applications/${CASE_ID}`]: {
        status: 200,
        body: { application: caseOf('DRAFT', { tenant_service_binding_id: INCOME_BINDING }) },
      },
    });
    const out = await ownDraft(citizen, CASE_ID, residence, RESIDENCE_FORM);
    expect(!out.ok && out.response.status).toBe(404);
  });

  it('refuses a submitted case and a republished form with explanations', async () => {
    platformHost({
      [`GET /v1/applications/${CASE_ID}`]: {
        status: 200,
        body: { application: caseOf('SUBMITTED') },
      },
    });
    const submitted = await ownDraft(citizen, CASE_ID, residence, RESIDENCE_FORM);
    expect(submitted.ok).toBe(false);
    if (!submitted.ok) {
      expect(submitted.response.status).toBe(409);
      expect(await submitted.response.json()).toMatchObject({
        message: ALREADY_SUBMITTED,
        application_id: CASE_ID,
      });
    }
    platformHost({
      [`GET /v1/applications/${CASE_ID}`]: { status: 200, body: { application: caseOf('DRAFT') } },
    });
    const changed = await ownDraft(
      citizen,
      CASE_ID,
      residence,
      '00000000-0000-4000-8000-000000000001',
    );
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(await changed.response.json()).toMatchObject({ message: FORM_CHANGED });
  });

  it('rejects malformed ids without calling the platform', async () => {
    const calls = platformHost({});
    const out = await ownDraft(citizen, 'not-a-uuid', residence, RESIDENCE_FORM);
    expect(!out.ok && out.response.status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe('writeDraftData', () => {
  it('pins the case form version, sends the revision and derives the idempotency key', async () => {
    const calls = platformHost({
      [`GET /v1/applications/${CASE_ID}/working-data`]: { status: 200, body: workingData(2) },
      [`PUT /v1/applications/${CASE_ID}/working-data`]: { status: 200, body: workingData(3) },
    });
    const out = await writeDraftData(
      citizen,
      caseOf('DRAFT'),
      { a: 1 },
      {
        expectedRevision: 2,
        key: `draft-${KEY}`,
      },
    );
    expect(out.ok && out.meta.revision).toBe(3);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({
      form_version_id: RESIDENCE_FORM,
      data: { a: 1 },
      expected_revision: 2,
    });
    expect(put?.key).toBe(`draft-${KEY}-data-r2`);
  });

  it('FAILURE: a stale revision becomes a reload message, not a silent overwrite', async () => {
    platformHost({
      [`GET /v1/applications/${CASE_ID}/working-data`]: { status: 200, body: workingData(5) },
      [`PUT /v1/applications/${CASE_ID}/working-data`]: {
        status: 409,
        body: { error_code: 'SF-APP-001' },
      },
    });
    const out = await writeDraftData(
      citizen,
      caseOf('DRAFT'),
      { a: 1 },
      {
        expectedRevision: 4,
        key: null,
      },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(409);
      expect(await out.response.json()).toMatchObject({ message: SAVED_ELSEWHERE });
    }
  });

  it('skips the write when the stored answers already match, and reopens READY_TO_SUBMIT', async () => {
    const same = platformHost({
      [`GET /v1/applications/${CASE_ID}/working-data`]: {
        status: 200,
        body: workingData(1, 'sha256:same'),
      },
    });
    const kept = await writeDraftData(
      citizen,
      caseOf('READY_TO_SUBMIT'),
      {},
      {
        expectedRevision: null,
        key: null,
        expectedHash: 'sha256:same',
      },
    );
    expect(kept.ok && kept.app.state).toBe('READY_TO_SUBMIT');
    expect(same.map((c) => c.method)).toEqual(['GET']);

    const reopened = platformHost({
      [`GET /v1/applications/${CASE_ID}/working-data`]: { status: 200, body: workingData(1) },
      [`POST /v1/applications/${CASE_ID}/commands`]: {
        status: 200,
        body: { application: caseOf('DRAFT') },
      },
      [`PUT /v1/applications/${CASE_ID}/working-data`]: {
        status: 200,
        body: workingData(2, 'sha256:new'),
      },
    });
    const out = await writeDraftData(
      citizen,
      caseOf('READY_TO_SUBMIT'),
      { b: 2 },
      {
        expectedRevision: null,
        key: `apply-${KEY}`,
        expectedHash: 'sha256:new',
      },
    );
    expect(out.ok && out.app.state).toBe('DRAFT');
    expect(reopened.find((c) => c.method === 'POST')?.body).toMatchObject({
      command: 'RETURN_TO_DRAFT',
      expected_state: 'READY_TO_SUBMIT',
    });
  });
});

describe('draft routes (BFF)', () => {
  const answers = { applicant_name: 'SAMPLE Draft Citizen' };

  it('NEGATIVE: anonymous, cross-site and key-less requests store nothing', async () => {
    const anonymous = platformHost({});
    const res = await createDraftRoute(
      new Request('http://127.0.0.1:3000/api/portal/drafts', {
        method: 'POST',
        headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ catalogue_id: 'IND-SOC-002', data: answers }),
      }),
    );
    expect(res.status).toBe(401);
    expect(anonymous.filter((c) => c.method !== 'GET')).toEqual([]);

    const cross = await createDraftRoute(
      new Request('http://127.0.0.1:3000/api/portal/drafts', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(cross.status).toBe(403);

    const keyless = platformHost(SIGNED_IN);
    const noKey = await createDraftRoute(
      browser('POST', '/api/portal/drafts', { catalogue_id: 'IND-SOC-002', data: answers }, null),
    );
    expect(noKey.status).toBe(400);
    expect(keyless.map((c) => c.path)).toEqual(['/v1/identity/me']);
  });

  it('NEGATIVE: SAMPLE_LAB refuses a non-synthetic name before any draft exists (Phase A L-2)', async () => {
    const calls = platformHost(SIGNED_IN);
    const res = await createDraftRoute(
      browser('POST', '/api/portal/drafts', {
        catalogue_id: 'IND-SOC-002',
        data: { applicant_name: 'Real Person' },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'applicant_name' });
    expect(calls.map((c) => c.path)).toEqual(['/v1/identity/me']);
  });

  it('creates one draft per form session on the placement binding and saves revision 1', async () => {
    const calls = platformHost({
      ...SIGNED_IN,
      'POST /v1/applications': { status: 201, body: { application: caseOf('DRAFT') } },
      [`GET /v1/applications/${CASE_ID}/working-data`]: { status: 404, body: {} },
      [`PUT /v1/applications/${CASE_ID}/working-data`]: { status: 200, body: workingData(1) },
    });
    const res = await createDraftRoute(
      browser('POST', '/api/portal/drafts', { catalogue_id: 'IND-SOC-002', data: answers }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      draft: {
        application_id: CASE_ID,
        catalogue_id: 'IND-SOC-002',
        revision: 1,
        form_version_id: RESIDENCE_FORM,
      },
      certified: false,
      g6_issued: false,
    });
    const create = calls.find((c) => c.method === 'POST' && c.path === '/v1/applications');
    expect(create?.body).toEqual({ tenant_service_binding_id: RESIDENCE_BINDING });
    expect(create?.key).toBe(`draft-${KEY}-create`);
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ expected_revision: 0 });
  });

  it('reads a draft back for its owner and reports a submitted one as such', async () => {
    platformHost({
      ...SIGNED_IN,
      [`GET /v1/applications/${CASE_ID}`]: { status: 200, body: { application: caseOf('DRAFT') } },
      [`GET /v1/applications/${CASE_ID}/working-data`]: { status: 200, body: workingData(4) },
    });
    const res = await readDraftRoute(browser('GET', `/api/portal/drafts/${CASE_ID}`), ctx(CASE_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      draft: { revision: 4, catalogue_id: 'IND-SOC-002', data: { applicant_name: 'SAMPLE Saved' } },
    });

    platformHost({
      ...SIGNED_IN,
      [`GET /v1/applications/${CASE_ID}`]: {
        status: 200,
        body: { application: caseOf('RECEIVED') },
      },
    });
    const done = await readDraftRoute(
      browser('GET', `/api/portal/drafts/${CASE_ID}`),
      ctx(CASE_ID),
    );
    expect(done.status).toBe(409);
    expect(await done.json()).toMatchObject({ application_id: CASE_ID });
  });

  it('requires the last saved revision on update', async () => {
    const calls = platformHost(SIGNED_IN);
    const res = await saveDraftRoute(
      browser('PUT', `/api/portal/drafts/${CASE_ID}`, {
        catalogue_id: 'IND-SOC-002',
        data: answers,
      }),
      ctx(CASE_ID),
    );
    expect(res.status).toBe(400);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('My applications draft card', () => {
  it('labels a draft as not submitted and links to resume it on its own service', () => {
    expect(applicationStatus({ status: 'DRAFT', digilocker: { status: 'NOT_REQUESTED' } })).toEqual(
      {
        label: 'Saved draft · not submitted yet',
        tone: 'neutral',
      },
    );
    const html = renderToStaticMarkup(
      <ApplicationCard
        app={{
          id: CASE_ID,
          status: 'DRAFT',
          applicant_name: 'SAMPLE',
          catalogue_id: 'IND-SOC-031',
          service_name: 'Income Certificate',
          updated_at: '2026-11-24T10:05:00.000Z',
          digilocker: { status: 'NOT_REQUESTED' },
        }}
      />,
    );
    expect(html).toContain('Income Certificate');
    expect(html).toContain(`href="/services/IND-SOC-031/apply?draft=${CASE_ID}"`);
    expect(html).toContain('Continue application');
    expect(html).toContain('Saved 24 Nov 2026');
    expect(html).not.toContain('Residence Certificate');
  });

  it('keeps View for submitted applications', () => {
    const html = renderToStaticMarkup(
      <ApplicationCard
        app={{
          id: CASE_ID,
          status: 'SUBMITTED',
          applicant_name: 'SAMPLE',
          service_name: 'Residence Certificate',
          submitted_at: '2026-11-24T10:05:00.000Z',
          digilocker: { status: 'NOT_REQUESTED' },
        }}
      />,
    );
    expect(html).toContain(`href="/certificates/${CASE_ID}"`);
    expect(html).toContain('Submitted 24 Nov 2026');
  });
});
