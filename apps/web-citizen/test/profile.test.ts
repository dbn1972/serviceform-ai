import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedVersion, templateByCatalogueId } from '@serviceform/service-templates';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Citizen } from '../lib/portal/platform';
import {
  PROFILE_PURPOSE,
  profilePrefill,
  readProfile,
  registerProfile,
} from '../lib/portal/profile';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const CITIZEN: Citizen = {
  token: 'T'.repeat(43),
  citizen_id: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
  assurance: 'OTP',
};
const PURPOSE_ID = '0d15ba00-3030-4000-8000-0d15ba003030';
const NAME = 'SAMPLE Profile Citizen';
const MOBILE = '9876500001';

type Call = { method: string; path: string; body: unknown; headers: Record<string, string> };

/** Stubs the platform host; `reply` answers per method + path. */
function stubPlatform(reply: (c: Call) => { status: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call: Call = {
      method: String(init.method),
      path: url.replace('http://platform.test', ''),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    };
    calls.push(call);
    const out = reply(call);
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status });
  });
  return calls;
}

const claimsBody = (name: string, mobile: string) => ({
  profile_id: 'p',
  subject_id: CITIZEN.citizen_id,
  claims: [
    { section_code: 'IDENTITY', claim_code: 'DISPLAY_NAME', value_text: name },
    { section_code: 'IDENTITY', claim_code: 'CONTACT_PHONE', value_text: mobile },
    { section_code: 'ADDRESS', claim_code: 'LOCALITY', value_text: 'SAMPLE Locality' },
  ],
});

beforeAll(() => {
  process.env['SF_API_BASE_URL'] = 'http://platform.test';
  process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
    ROOT,
    'fixtures/lab/platform/placement.citizen.json',
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// REQ: SF-M10-B-2d CMP-005 profile read with the citizen bearer, consent-gated, synthetic only.
describe('readProfile', () => {
  it('reads the consented profile with the citizen bearer for the profile purpose', async () => {
    const calls = stubPlatform(() => ({ status: 200, body: claimsBody(NAME, MOBILE) }));
    expect(await readProfile(CITIZEN)).toEqual({ display_name: NAME, mobile: MOBILE });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe(
      `/v1/profiles/${CITIZEN.citizen_id}?purpose_code=${PROFILE_PURPOSE}`,
    );
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${CITIZEN.token}`);
    expect(Object.keys(calls[0]?.headers ?? {})).not.toContain('cookie');
  });

  it('is null without consent, profile or platform', async () => {
    for (const status of [403, 404, 503]) {
      stubPlatform(() => ({ status, body: { error_code: 'SF-AUTH-002' } }));
      expect(await readProfile(CITIZEN)).toBeNull();
    }
  });

  it('drops values that fail the SAMPLE_LAB synthetic gate', async () => {
    stubPlatform(() => ({ status: 200, body: claimsBody('Real Person Name', '8123456789') }));
    expect(await readProfile(CITIZEN)).toEqual({});
  });
});

describe('registerProfile', () => {
  const happy = (c: Call) => {
    if (c.path === `/v1/profiles/${CITIZEN.citizen_id}`) return { status: 200 };
    if (c.path === '/v1/purposes')
      return {
        status: 200,
        body: { items: [{ code: PROFILE_PURPOSE, purpose_id: PURPOSE_ID, status: 'ACTIVE' }] },
      };
    if (c.path === '/v1/consents') return { status: 201, body: { status: 'GRANTED' } };
    return { status: 200 };
  };

  it('ensures the profile, grants SELF consent, then writes the claims', async () => {
    const calls = stubPlatform(happy);
    expect(await registerProfile(CITIZEN, { display_name: NAME, mobile: MOBILE })).toEqual({
      ok: true,
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /v1/profiles/${CITIZEN.citizen_id}`,
      'GET /v1/purposes',
      'POST /v1/consents',
      `PUT /v1/profiles/${CITIZEN.citizen_id}/claims`,
    ]);
    expect(calls[2]?.body).toEqual({
      subject_id: CITIZEN.citizen_id,
      purpose_id: PURPOSE_ID,
      channel: 'WEB',
      representation_basis: 'SELF',
    });
    expect(calls[3]?.body).toEqual({
      purpose_code: PROFILE_PURPOSE,
      claims: [
        { section_code: 'IDENTITY', claim_code: 'DISPLAY_NAME', value_text: NAME },
        { section_code: 'IDENTITY', claim_code: 'CONTACT_PHONE', value_text: MOBILE },
      ],
    });
    for (const c of calls.filter((x) => x.method !== 'GET')) {
      expect(c.headers['idempotency-key']).toMatch(/^portal-/);
    }
  });

  it('reuses a consent the citizen already holds', async () => {
    stubPlatform((c) =>
      c.path === '/v1/consents' ? { status: 409, body: { error_code: 'SF-APP-002' } } : happy(c),
    );
    expect((await registerProfile(CITIZEN, { display_name: NAME, mobile: MOBILE })).ok).toBe(true);
  });

  it('stops at the failing step and never writes claims without consent', async () => {
    const noPurpose = stubPlatform((c) =>
      c.path === '/v1/purposes' ? { status: 200, body: { items: [] } } : happy(c),
    );
    expect(await registerProfile(CITIZEN, { display_name: NAME, mobile: MOBILE })).toEqual({
      ok: false,
      step: 'PURPOSE',
      status: 200,
    });
    expect(noPurpose.map((c) => c.path)).not.toContain(`/v1/profiles/${CITIZEN.citizen_id}/claims`);
    const denied = stubPlatform((c) =>
      c.path === '/v1/consents' ? { status: 403, body: { error_code: 'SF-AUTH-002' } } : happy(c),
    );
    expect(await registerProfile(CITIZEN, { display_name: NAME, mobile: MOBILE })).toMatchObject({
      ok: false,
      step: 'CONSENT',
    });
    expect(denied).toHaveLength(3);
  });
});

describe('profilePrefill (semantic element binding)', () => {
  const template = templateByCatalogueId('IND-SOC-002');
  const version = template ? publishedVersion(template) : null;

  it('overlays profile claims on the fields bound to their semantic ids', () => {
    expect(version).not.toBeNull();
    const schema = version?.form.json_schema ?? {};
    const sample = version?.sample_data ?? {};
    const out = profilePrefill(schema, sample, { display_name: NAME, mobile: MOBILE });
    expect(out).toMatchObject({ applicant_name: NAME, applicant_mobile: MOBILE });
    expect(out['residence_address']).toEqual(sample['residence_address']);
    expect(sample['applicant_name']).toBe('SAMPLE Lab Citizen');
  });

  it('keeps the sample answers without a profile and ignores non-synthetic claims', () => {
    const schema = version?.form.json_schema ?? {};
    const sample = version?.sample_data ?? {};
    expect(profilePrefill(schema, sample, null)).toBe(sample);
    const out = profilePrefill(schema, sample, { display_name: 'Real Person', mobile: '1234' });
    expect(out['applicant_name']).toBe('SAMPLE Lab Citizen');
    expect(out['applicant_mobile']).toBeUndefined();
  });
});
