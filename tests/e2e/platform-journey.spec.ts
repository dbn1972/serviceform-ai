/**
 * SF-M10-B-2 platform-path journey (SAMPLE_LAB): Citizen Portal and Officer Workbench BFFs on
 * CMP-004 identity (opaque sessions) and CMP-015 application/case (PostgreSQL FORCE RLS + OPA).
 * Requires `scripts/dev/platform-lab.sh up`. OTP/IdP SIMULATED; after the HUMAN approval the host
 * issues (CMP-022/024, SIMULATED eSign) and publishes via SIMULATED DigiLocker (CMP-012, SF-M10-B-3).
 * Not CERTIFIED. G6 not issued. No REAL DigiLocker.
 * REQ: INT-001, INT-004, INT-011; ADR-0007; Phase A L-1/L-2; DESIGN-SYSTEM.md rule 6; CCR-M10-003.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomInt } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';
const OFFICER = 'http://127.0.0.1:3001';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const uniqueMobile = () => `9${randomInt(100_000_000, 1_000_000_000)}`;

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function simulatedCode(page: Page): Promise<string> {
  const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
  await expect(code).toHaveText(/^\d{6}$/);
  return (await code.textContent()) ?? '';
}

async function requestOtp(page: Page, mobile: string): Promise<string> {
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
  await page.getByRole('button', { name: 'Get OTP' }).click();
  return simulatedCode(page);
}

async function signIn(page: Page, mobile: string, path = '/services/IND-SOC-002'): Promise<void> {
  await open(page, `${CITIZEN}/login?next=${encodeURIComponent(path)}`);
  const code = await requestOtp(page, mobile);
  await page.getByLabel('Digit 1 of 6').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(`${CITIZEN}${path}`);
}

async function submitApplication(page: Page, name = 'SAMPLE Platform Citizen'): Promise<string> {
  await open(page, `${CITIZEN}/services/IND-SOC-002/apply`);
  await page.getByLabel('Full name (as per official record)').fill(name);
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: /Save & continue/i }).click();
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Submit application/i }).click();
  await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop() ?? '';
}

const RESIDENCE_FORM = ['ind-soc-002', 'application'].join('.');

/** Valid IND-SOC-002 v1.0.0 data (synthetic). */
function syntheticData(name: string): Record<string, unknown> {
  return {
    applicant_name: name,
    applicant_dob: '1990-01-01',
    applicant_gender: 'FEMALE',
    residence_address: {
      house_no_or_name: 'SAMPLE 1',
      locality: 'SAMPLE',
      district: 'SAMPLE',
      state_code: 'OD',
      pincode: '751001',
    },
    residence_duration_months: 24,
    purpose_of_certificate: 'SAMPLE',
    evidence_type: 'ELECTRICITY_BILL',
    evidence_file_name: 'sample.pdf',
    declaration_accepted: true,
  };
}

async function officerSignIn(page: Page, path = '/applications'): Promise<void> {
  await open(page, `${OFFICER}/login?next=${encodeURIComponent(path)}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${OFFICER}${path}`);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function cookieFor(page: Page, name: string): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === name);
  expect(cookie, name).toBeDefined();
  return `${name}=${cookie?.value ?? ''}`;
}

async function api(request: APIRequestContext, url: string, cookie: string) {
  return request.get(url, { headers: { cookie } });
}

test.describe('citizen identity on CMP-004 (opaque session, ADR-0007 D-3)', () => {
  test('anonymous gated page → OTP from SIMULATED SMS → back to the page', async ({ page }) => {
    await open(page, `${CITIZEN}/services/IND-SOC-002`);
    await expect(page).toHaveURL(/\/login\?next=%2Fservices%2FIND-SOC-002$/);
    const code = await requestOtp(page, uniqueMobile());
    await page.getByLabel('Digit 1 of 6').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/services/IND-SOC-002`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Residence Certificate');
  });

  test('the session cookie is opaque, HttpOnly and carries no identity claims', async ({
    page,
  }) => {
    await signIn(page, uniqueMobile());
    const cookie = (await page.context().cookies()).find((c) => c.name === 'sf_citizen_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(() => JSON.parse(Buffer.from(cookie?.value ?? '', 'base64url').toString())).toThrow();
    expect((await page.context().cookies()).map((c) => c.name)).not.toContain(
      'sf_citizen_lab_session',
    );
  });

  test('NEGATIVE: a forged or legacy lab cookie is anonymous (Phase A L-1 closed)', async ({
    request,
  }) => {
    const legacy = Buffer.from(
      JSON.stringify({ surface: 'citizen_web', citizen_id: 'x', simulation: true }),
    ).toString('base64url');
    for (const cookie of [
      `sf_citizen_lab_session=${legacy}`,
      `sf_citizen_session=${'A'.repeat(43)}`,
      `sf_citizen_session=${legacy}`,
    ]) {
      const session = await api(request, `${CITIZEN}/api/portal/session`, cookie);
      expect(await session.json()).toMatchObject({ authenticated: false });
      const mine = await api(request, `${CITIZEN}/api/portal/applications`, cookie);
      expect(mine.status()).toBe(401);
    }
  });

  test('NEGATIVE: five wrong codes lock the challenge; the correct code is then refused', async ({
    page,
  }) => {
    await open(page, `${CITIZEN}/login`);
    const code = await requestOtp(page, uniqueMobile());
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await page.getByLabel('Digit 1 of 6').fill(wrong);
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      await expect(page.getByText(/incorrect, has expired, or too many attempts/i)).toBeVisible();
    }
    await page.getByLabel('Digit 1 of 6').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText(/incorrect, has expired, or too many attempts/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  for (const next of [
    '/%09/evil.example',
    '/%0A/evil.example',
    '//evil.example',
    '/.//evil.example',
    '/..//evil.example',
  ]) {
    test(`ignores off-site next target ${next} (open-redirect guard)`, async ({ page }) => {
      await open(page, `${CITIZEN}/login?next=${next}`);
      const code = await requestOtp(page, uniqueMobile());
      await page.getByLabel('Digit 1 of 6').fill(code);
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      await expect(page).toHaveURL(`${CITIZEN}/services`);
    });
  }

  test('register records CMP-030 consent and a CMP-005 profile used for the name and prefill', async ({
    page,
  }) => {
    const mobile = uniqueMobile();
    await open(page, `${CITIZEN}/register?next=%2Fcertificates`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account');
    await page.getByLabel('Full name').fill('SAMPLE Registered Citizen');
    await page.getByLabel(/I agree to keep my name and mobile number/).check();
    const code = await requestOtp(page, mobile);
    await page.getByLabel('Digit 1 of 6').fill(code);
    await page.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/certificates`);
    await expect(page.getByTestId('applications-empty')).toBeVisible();
    const account = page.getByTestId('citizen-account');
    await expect(account).toContainText('SAMPLE Registered Citizen');
    await expect(account).toContainText(`+91 ${mobile.slice(0, 5)}`);
    const cookie = await cookieFor(page, 'sf_citizen_session');
    expect(cookie).not.toContain('SAMPLE');
    const session = await (await api(page.request, `${CITIZEN}/api/portal/session`, cookie)).json();
    expect(session).toMatchObject({
      authenticated: true,
      display_name: 'SAMPLE Registered Citizen',
      profile_source: 'CMP-005',
      g6_issued: false,
    });
    expect(JSON.stringify(session)).not.toContain(mobile);

    await open(page, `${CITIZEN}/services/IND-SOC-002/apply`);
    await expect(page.getByLabel('Full name (as per official record)')).toHaveValue(
      'SAMPLE Registered Citizen',
    );
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: /Save & continue/i }).click();
    }
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Submit application/i }).click();
    await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
    const mobileValue = page
      .locator('dt', { hasText: /^Mobile$/ })
      .locator('xpath=following-sibling::dd[1]');
    await expect(mobileValue).toContainText(`+91 ${mobile.slice(0, 5)}`);
    await expect(mobileValue).not.toHaveText('—');
  });

  test('NEGATIVE: register refuses a non-synthetic name or missing consent before any OTP', async ({
    page,
  }) => {
    await open(page, `${CITIZEN}/register`);
    await page.getByLabel('Full name').fill('Not A Sample');
    await page.getByLabel('Mobile number', { exact: true }).fill(uniqueMobile());
    await page.getByRole('button', { name: 'Get OTP' }).click();
    await expect(page.getByTestId('simulated-sms')).toHaveCount(0);
    await expect(page.getByLabel('Full name')).toBeFocused();
    await expect(page.locator('#register-consent-error')).toBeVisible();
  });

  test('NEGATIVE: the session API refuses an invalid registration payload', async ({ page }) => {
    await open(page, `${CITIZEN}/register`);
    await page.getByLabel('Full name').fill('SAMPLE Valid Citizen');
    await page.getByLabel(/I agree to keep my name and mobile number/).check();
    const code = await requestOtp(page, uniqueMobile());
    const res = await page.request.post(`${CITIZEN}/api/portal/session`, {
      headers: { origin: CITIZEN },
      data: {
        challenge_id: '00000000-0000-4000-8000-000000000000',
        code,
        registration: { display_name: 'Not A Sample', mobile: '9000000000', consent: false },
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).field_errors).toMatchObject({
      display_name: expect.any(String),
      consent: expect.any(String),
    });
  });

  test('sign-out revokes the CMP-004 session, not just the cookie', async ({ page, request }) => {
    await signIn(page, uniqueMobile());
    const cookie = await cookieFor(page, 'sf_citizen_session');
    await page.getByRole('button', { name: /Sign out/i }).click();
    await expect(page).toHaveURL(/\/login\?signed_out=1/);
    const replay = await api(request, `${CITIZEN}/api/portal/applications`, cookie);
    expect(replay.status()).toBe(401);
  });
});

test.describe('application journey on CMP-015 (RLS + OPA citizen-owner)', () => {
  test.describe.configure({ timeout: 90_000 });
  test('a submitted application is stored on the platform and listed for its owner', async ({
    page,
  }) => {
    await signIn(page, uniqueMobile());
    const id = await submitApplication(page);
    await expect(page.getByText(/Awaiting officer decision/i)).toBeVisible();
    await expect(page.getByText('SAMPLE Platform Citizen').first()).toBeVisible();
    const cookie = await cookieFor(page, 'sf_citizen_session');
    const res = await page.request.get(`${CITIZEN}/api/portal/applications/${id}`, {
      headers: { cookie },
    });
    expect(await res.json()).toMatchObject({
      source: 'PLATFORM',
      application: { id, platform_state: 'SUBMITTED', applicant_name: 'SAMPLE Platform Citizen' },
    });
    await open(page, `${CITIZEN}/certificates`);
    await expect(page.getByText(`Ref ${id.slice(0, 8).toUpperCase()}`)).toBeVisible();
  });

  test('NEGATIVE: another citizen cannot list or open the application (IDOR)', async ({
    browser,
  }) => {
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner, uniqueMobile());
    const id = await submitApplication(owner);
    const other = await (await browser.newContext()).newPage();
    await signIn(other, uniqueMobile());
    const otherCookie = await cookieFor(other, 'sf_citizen_session');
    const list = await other.request.get(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie: otherCookie },
    });
    const ids = ((await list.json()) as { applications: { id: string }[] }).applications.map(
      (a) => a.id,
    );
    expect(ids).not.toContain(id);
    const direct = await other.request.get(`${CITIZEN}/api/portal/applications/${id}`, {
      headers: { cookie: otherCookie },
    });
    expect(direct.status()).toBe(404);
    await open(other, `${CITIZEN}/certificates/${id}`);
    await expect(other.getByText(/could not find this application/i).first()).toBeVisible();
    await owner.close();
    await other.close();
  });

  test('NEGATIVE: non-synthetic applicant names are refused server-side (Phase A L-2)', async ({
    page,
  }) => {
    await signIn(page, uniqueMobile());
    const res = await page.request.post(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie: await cookieFor(page, 'sf_citizen_session') },
      data: { catalogue_id: 'IND-SOC-002', data: syntheticData('Real Person') },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'applicant_name' });
  });

  test('a retried submit with the same form-session key files one application (INT-F5)', async ({
    page,
  }) => {
    await signIn(page, uniqueMobile());
    const cookie = await cookieFor(page, 'sf_citizen_session');
    const form = { catalogue_id: 'IND-SOC-002', data: syntheticData('SAMPLE Retry Citizen') };
    const key = `retry${randomInt(1_000_000_000, 9_999_999_999)}abcdef`;
    const submit = () =>
      page.request.post(`${CITIZEN}/api/portal/applications`, {
        headers: { cookie, 'idempotency-key': key },
        data: form,
      });
    const first = await submit();
    const second = await submit();
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    const id = ((await first.json()) as { application: { id: string } }).application.id;
    expect(((await second.json()) as { application: { id: string } }).application.id).toBe(id);
    const list = await page.request.get(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie },
    });
    const ids = ((await list.json()) as { applications: { id: string }[] }).applications.map(
      (a) => a.id,
    );
    expect(ids).toEqual([id]);
  });

  test('NEGATIVE: cross-site writes are refused on both portals (SEC F-07)', async ({ page }) => {
    await signIn(page, uniqueMobile());
    const cookie = await cookieFor(page, 'sf_citizen_session');
    const crossSite = await page.request.post(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
      data: {},
    });
    expect(crossSite.status()).toBe(403);
    const fetchSite = await page.request.post(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      data: {},
    });
    expect(fetchSite.status()).toBe(403);
    const plain = await page.request.post(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie, 'content-type': 'text/plain' },
      data: '{}',
    });
    expect(plain.status()).toBe(415);
    const officer = await page.request.post(
      `${OFFICER}/api/portal/applications/00000000-0000-4000-8000-000000000001`,
      { headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, data: '{}' },
    );
    expect(officer.status()).toBe(403);
  });

  test('anonymous submit and anonymous listing are refused', async ({ request }) => {
    expect((await request.get(`${CITIZEN}/api/portal/applications`)).status()).toBe(401);
    expect((await request.post(`${CITIZEN}/api/portal/applications`, { data: {} })).status()).toBe(
      401,
    );
  });
});

test.describe('metadata-driven apply on CMP-009 (CCR-M10-002)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('the wizard is rendered from the pinned published form and its rules', async ({ page }) => {
    await signIn(page, uniqueMobile());
    await open(page, `${CITIZEN}/services/IND-SOC-002/apply`);
    const steps = page.getByRole('navigation', { name: 'Application steps' }).getByRole('button');
    await expect(steps).toHaveText([/Applicant/, /Residence/, /Evidence/, /Preview/]);
    await expect(
      page.getByText(/Form ind-soc-002\.application · v1\.0\.0 · pinned sha256:/),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '1. Applicant details' })).toBeVisible();
    await expect(page.getByLabel('Full name (as per official record)')).toHaveValue(
      'SAMPLE Lab Citizen',
    );
    await expectNoAxeViolations(page);

    const email = page.getByLabel('Email address');
    await expect(email).toHaveCount(0);
    await page.getByLabel('Also send status updates by email').check();
    await expect(email).toBeVisible();
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await expect(page.getByTestId('error-summary')).toBeFocused();
    await expect(page.getByText('Enter an email address').first()).toBeVisible();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Also send status updates by email').uncheck();
    await expect(email).toHaveCount(0);
    await page.getByRole('button', { name: /Save & continue/i }).click();

    await page.getByLabel('PIN code').fill('7510');
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await expect(page.getByText('PIN code must be 6 digits').first()).toBeVisible();
    await page.getByLabel('PIN code').fill('751001');
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await page.getByRole('button', { name: /Save & continue/i }).click();

    await expect(page.getByText('Indicative check: met')).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: '751001' })).toBeVisible();
    await page.getByRole('button', { name: /Submit application/i }).click();
    await expect(page.getByText('Confirm the declaration before submit').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Submit application/i }).click();
    await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
  });

  test('CMP-009 is authoritative: invalid answers are refused per field and nothing is filed', async ({
    page,
  }) => {
    await signIn(page, uniqueMobile());
    const cookie = await cookieFor(page, 'sf_citizen_session');
    const data = syntheticData('SAMPLE Invalid Citizen');
    const res = await page.request.post(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie },
      data: {
        catalogue_id: 'IND-SOC-002',
        data: {
          ...data,
          residence_address: { ...(data['residence_address'] as object), pincode: '75' },
          declaration_accepted: false,
          unexpected_field: 'x',
        },
      },
    });
    expect(res.status()).toBe(422);
    const body = (await res.json()) as { field_errors: { pointer: string; code: string }[] };
    expect(body.field_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '/residence_address/pincode', code: 'PATTERN' }),
        expect.objectContaining({ pointer: '/declaration_accepted', code: 'CONST_MISMATCH' }),
        expect.objectContaining({ pointer: '/unexpected_field', code: 'ADDITIONAL_PROPERTY' }),
      ]),
    );
    const list = await page.request.get(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie },
    });
    expect(((await list.json()) as { applications: unknown[] }).applications).toEqual([]);
  });

  test('only offered services expose a form; catalogue stubs are not offered', async ({
    page,
    request,
  }) => {
    expect((await request.get(`${CITIZEN}/api/portal/forms/IND-SOC-002`)).status()).toBe(401);
    await signIn(page, uniqueMobile());
    const cookie = await cookieFor(page, 'sf_citizen_session');
    const form = await page.request.get(`${CITIZEN}/api/portal/forms/IND-SOC-002`, {
      headers: { cookie },
    });
    expect(form.status()).toBe(200);
    expect(await form.json()).toMatchObject({
      engine: 'CMP-009',
      publication: 'SIMULATED',
      g6_issued: false,
      form: {
        pin: {
          form_key: RESIDENCE_FORM,
          version_id: '0d15ba00-0010-4000-8000-0d15ba000010',
          content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
        version: '1.0.0',
      },
    });
    for (const id of ['IND-SOC-031', 'IND-CIV-001', 'NOT-A-SERVICE']) {
      const stub = await page.request.get(`${CITIZEN}/api/portal/forms/${id}`, {
        headers: { cookie },
      });
      expect(stub.status(), id).toBe(404);
    }
    const apply = await page.request.post(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie },
      data: { catalogue_id: 'IND-SOC-031', data: syntheticData('SAMPLE Stub Citizen') },
    });
    expect(apply.status()).toBe(404);
  });
});

test.describe('officer decision on CMP-015 (CMP-004 officer session, HUMAN decision)', () => {
  test.describe.configure({ timeout: 90_000 });
  test('the workbench requires sign-in', async ({ page, request }) => {
    await open(page, `${OFFICER}/applications`);
    await expect(page).toHaveURL(/\/login\?next=%2Fapplications$/);
    expect((await request.get(`${OFFICER}/api/portal/applications`)).status()).toBe(401);
  });

  test('citizen applies → officer approves → credential issued and in DigiLocker (SIMULATED)', async ({
    browser,
  }) => {
    const citizen = await (await browser.newContext()).newPage();
    await signIn(citizen, uniqueMobile());
    const id = await submitApplication(citizen, 'SAMPLE Decision Citizen');

    const officer = await (await browser.newContext()).newPage();
    await officerSignIn(officer);
    await expect(officer.getByText(`Ref ${id.slice(0, 8)}…`)).toBeVisible();
    await open(officer, `${OFFICER}/applications/${id}`);
    await expect(officer.getByText('SAMPLE Decision Citizen')).toBeVisible();
    await officer.getByRole('button', { name: 'Approve' }).click();
    await expect(officer.getByText(/recorded on the case as a human decision/i)).toBeVisible();
    await expect(officer.getByText(/published to DigiLocker \(SIMULATED\)/i)).toBeVisible();
    await expect(officer.getByText('ISSUED', { exact: true }).first()).toBeVisible();
    await expect(officer.getByText('DigiLocker · PUBLISHED')).toBeVisible();
    await expectNoAxeViolations(officer);

    await open(citizen, `${CITIZEN}/certificates/${id}`);
    await expect(citizen.getByText('Saved to DigiLocker (SIMULATED)')).toBeVisible();
    await expect(citizen.getByText('DigiLocker · PUBLISHED')).toBeVisible();
    await expect(citizen.getByText(/^[0-9a-f]{8}-[0-9a-f-]{27}$/)).toBeVisible();
    await expectNoAxeViolations(citizen);
    await citizen.close();
    await officer.close();
  });

  test('NEGATIVE: a citizen session cannot act on the workbench API', async ({ page, request }) => {
    await signIn(page, uniqueMobile());
    const id = await submitApplication(page);
    const token = (await cookieFor(page, 'sf_citizen_session')).split('=')[1];
    const res = await request.post(`${OFFICER}/api/portal/applications/${id}`, {
      headers: { cookie: `sf_officer_session=${token}` },
      data: { action: 'APPROVE' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('platform journey accessibility (WCAG 2.1 AA, UX4G rule 6)', () => {
  test.describe.configure({ timeout: 120_000 });
  test('citizen and officer journey pages have no axe violations and reflow at 320 px', async ({
    browser,
  }) => {
    const citizen = await (await browser.newContext()).newPage();
    await signIn(citizen, uniqueMobile());
    const id = await submitApplication(citizen);
    const officer = await (await browser.newContext()).newPage();
    await officerSignIn(officer);
    const pages: [Page, string][] = [
      [citizen, `${CITIZEN}/certificates`],
      [citizen, `${CITIZEN}/certificates/${id}`],
      [officer, `${OFFICER}/applications`],
      [officer, `${OFFICER}/applications/${id}`],
    ];
    for (const [page, url] of pages) {
      await open(page, url);
      await expectNoAxeViolations(page);
      await page.setViewportSize({ width: 320, height: 800 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, url).toBe(false);
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await open(officer, `${OFFICER}/login`);
    await expectNoAxeViolations(officer);
    await citizen.close();
    await officer.close();
  });
});

test.describe('citizen auth pages (WCAG 2.1 AA, keyboard, UX4G rule 6)', () => {
  test('validates the mobile number before sending an OTP', async ({ page }) => {
    await open(page, `${CITIZEN}/login`);
    await page.getByLabel('Mobile number', { exact: true }).fill('81234');
    await page.getByRole('button', { name: 'Get OTP' }).click();
    const mobile = page.getByLabel('Mobile number', { exact: true });
    await expect(page.getByText('Enter a 10-digit mobile number')).toBeVisible();
    await expect(mobile).toHaveAttribute('aria-invalid', 'true');
    await expect(mobile).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Enter the OTP' })).toHaveCount(0);
  });

  test('OTP entry supports keyboard auto-advance and backspace', async ({ page }) => {
    await open(page, `${CITIZEN}/login`);
    await requestOtp(page, uniqueMobile());
    await expect(page.getByLabel('Digit 1 of 6')).toBeFocused();
    await page.keyboard.type('12');
    await expect(page.getByLabel('Digit 3 of 6')).toBeFocused();
    await page.keyboard.press('Backspace');
    await expect(page.getByLabel('Digit 2 of 6')).toBeFocused();
    await expect(page.getByLabel('Digit 2 of 6')).toHaveValue('');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByLabel('Digit 1 of 6')).toBeFocused();
  });

  test('a wrong code marks the OTP invalid and returns focus to it', async ({ page }) => {
    await open(page, `${CITIZEN}/login`);
    const code = await requestOtp(page, uniqueMobile());
    await page.getByLabel('Digit 1 of 6').fill(code === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByLabel('Digit 1 of 6')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Digit 1 of 6')).toBeFocused();
    await expectNoAxeViolations(page);
  });

  for (const [name, path, title] of [
    ['sign in', '/login', 'Sign in - ServiceForm AI - Citizen Portal'],
    ['create account', '/register', 'Create account - ServiceForm AI - Citizen Portal'],
  ] as const) {
    test(`${name}: unique title, single h1, landmarks, no axe violations, 320 px reflow`, async ({
      page,
    }) => {
      await open(page, `${CITIZEN}${path}`);
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('complementary')).toBeVisible();
      await expectNoAxeViolations(page);
      await page.setViewportSize({ width: 320, height: 640 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
