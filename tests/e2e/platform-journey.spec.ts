/**
 * SF-M10-B-2 platform-path journey (SAMPLE_LAB): Citizen Portal and Officer Workbench BFFs on
 * CMP-004 identity (opaque sessions) and CMP-015 application/case (PostgreSQL FORCE RLS + OPA).
 * Requires `scripts/dev/platform-lab.sh up`. OTP/IdP SIMULATED; certificate issuance and
 * DigiLocker are not wired on this slice. Not CERTIFIED. G6 not issued.
 * REQ: INT-001, INT-004, INT-011; ADR-0007; Phase A L-1/L-2; DESIGN-SYSTEM.md rule 6.
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

  for (const next of ['/%09/evil.example', '/%0A/evil.example', '//evil.example']) {
    test(`ignores off-site next target ${next} (open-redirect guard)`, async ({ page }) => {
      await open(page, `${CITIZEN}/login?next=${next}`);
      const code = await requestOtp(page, uniqueMobile());
      await page.getByLabel('Digit 1 of 6').fill(code);
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      await expect(page).toHaveURL(`${CITIZEN}/services`);
    });
  }

  test('register uses the same OTP flow and signs the new citizen in', async ({ page }) => {
    await open(page, `${CITIZEN}/register?next=%2Fcertificates`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account');
    const code = await requestOtp(page, uniqueMobile());
    await page.getByLabel('Digit 1 of 6').fill(code);
    await page.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/certificates`);
    await expect(page.getByTestId('applications-empty')).toBeVisible();
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
      data: {
        applicant_name: 'Real Person',
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
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'applicant_name' });
  });

  test('a retried submit with the same form-session key files one application (INT-F5)', async ({
    page,
  }) => {
    await signIn(page, uniqueMobile());
    const cookie = await cookieFor(page, 'sf_citizen_session');
    const form = {
      applicant_name: 'SAMPLE Retry Citizen',
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
    };
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

  test('anonymous submit and anonymous listing are refused', async ({ request }) => {
    expect((await request.get(`${CITIZEN}/api/portal/applications`)).status()).toBe(401);
    expect((await request.post(`${CITIZEN}/api/portal/applications`, { data: {} })).status()).toBe(
      401,
    );
  });
});

test.describe('officer decision on CMP-015 (CMP-004 officer session, HUMAN decision)', () => {
  test.describe.configure({ timeout: 90_000 });
  test('the workbench requires sign-in', async ({ page, request }) => {
    await open(page, `${OFFICER}/applications`);
    await expect(page).toHaveURL(/\/login\?next=%2Fapplications$/);
    expect((await request.get(`${OFFICER}/api/portal/applications`)).status()).toBe(401);
  });

  test('citizen applies → officer approves → citizen sees Approved', async ({ browser }) => {
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
    await expect(officer.getByText('APPROVED', { exact: true }).first()).toBeVisible();

    await open(citizen, `${CITIZEN}/certificates/${id}`);
    await expect(citizen.getByText(/Approved — certificate not yet issued/i)).toBeVisible();
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
