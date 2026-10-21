/**
 * Citizen identity & access (SAMPLE_LAB): sign in and create account with SIMULATED mobile OTP.
 * REQ: SRS-F-010 (SIMULATED OTP in non-prod), INT-001 (citizen auth → profile),
 * DESIGN-SYSTEM.md rule 6 (journey-level accessibility). Not production IAM; G6 not issued.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';
const SEED_MOBILE = '9876543210';
const OTP = '123456';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const uniqueMobile = () => `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${CITIZEN}${path}`);
  await page.waitForLoadState('networkidle');
}

async function requestSignInOtp(page: Page, mobile: string): Promise<void> {
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the OTP' })).toBeVisible();
}

async function fillRegistration(page: Page, mobile: string): Promise<void> {
  await page.getByLabel('Full name', { exact: true }).fill('SAMPLE Asha Devi');
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
  await page.getByLabel(/Email address/).fill('asha.sample@example.org');
  await page.locator('label[for="reg-consent"]').click();
}

/** Session cookies are `Secure` under `next start`; read them through the browser, not page.request. */
function browserSession(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => fetch('/api/lab/session').then((r) => r.json()));
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function apiChallenge(
  request: APIRequestContext,
  mobile: string,
  purpose: 'SIGN_IN' | 'REGISTER',
): Promise<string> {
  const res = await request.post(`${CITIZEN}/api/lab/otp/challenges`, {
    data: { mobile, purpose },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { challenge_id: string }).challenge_id;
}

test.describe('citizen sign in (mobile OTP)', () => {
  test('signs in the seeded synthetic citizen and returns to the requested page', async ({
    page,
  }) => {
    await open(page, '/login?next=%2Fcertificates');
    await requestSignInOtp(page, SEED_MOBILE);
    await expect(page.getByTestId('simulated-sms')).toContainText(OTP);
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await expect(page.getByLabel('Digit 6 of 6')).toHaveValue('6');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/certificates$/);
    expect(await browserSession(page)).toMatchObject({
      authenticated: true,
      auth_assurance: 'OTP',
      display_name: 'SAMPLE LAB Citizen',
      simulation: true,
      g6_issued: false,
    });
  });

  test('validates the mobile number before sending an OTP', async ({ page }) => {
    await open(page, '/login');
    await page.getByLabel('Mobile number', { exact: true }).fill('81234');
    await page.getByRole('button', { name: 'Get OTP' }).click();
    const mobile = page.getByLabel('Mobile number', { exact: true });
    await expect(page.getByText('Enter a 10-digit mobile number')).toBeVisible();
    await expect(mobile).toHaveAttribute('aria-invalid', 'true');
    await expect(mobile).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Enter the OTP' })).toHaveCount(0);
  });

  test('rejects a wrong OTP, reports remaining attempts and returns focus to the code', async ({
    page,
  }) => {
    await open(page, '/login');
    await requestSignInOtp(page, SEED_MOBILE);
    await page.getByLabel('Digit 1 of 6').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(
      page.getByText('The OTP you entered is incorrect. 4 attempts left.'),
    ).toBeVisible();
    await expect(page.getByLabel('Digit 1 of 6')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Digit 1 of 6')).toBeFocused();
    await expect(page).toHaveURL(/\/login/);
  });

  test('supports keyboard entry with auto-advance and backspace navigation', async ({ page }) => {
    await open(page, '/login');
    await requestSignInOtp(page, SEED_MOBILE);
    await expect(page.getByLabel('Digit 1 of 6')).toBeFocused();
    await page.keyboard.type('12');
    await expect(page.getByLabel('Digit 3 of 6')).toBeFocused();
    await page.keyboard.press('Backspace');
    await expect(page.getByLabel('Digit 2 of 6')).toBeFocused();
    await expect(page.getByLabel('Digit 2 of 6')).toHaveValue('');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByLabel('Digit 1 of 6')).toBeFocused();
  });

  test('a verified but unregistered number is offered account creation, not a retry', async ({
    page,
  }) => {
    const mobile = uniqueMobile();
    await open(page, '/login');
    await requestSignInOtp(page, mobile);
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    const alert = page.getByTestId('otp-blocking-error');
    await expect(alert).toContainText('There is no citizen account for this mobile number yet');
    await expect(alert.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      `/register?mobile=${mobile}`,
    );
    await expect(page.getByText('Mobile number verified.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify and sign in' })).toBeDisabled();
  });

  test('ignores off-site next targets (open-redirect guard)', async ({ page }) => {
    await open(page, '/login?next=%2F%2Fevil.example%2Fphish');
    await requestSignInOtp(page, SEED_MOBILE);
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/services`);
  });
});

test.describe('citizen account creation', () => {
  test('summarises errors, focuses the summary and links each error to its field', async ({
    page,
  }) => {
    await open(page, '/register');
    await page.getByRole('button', { name: 'Send OTP and continue' }).click();
    const summary = page.getByTestId('error-summary');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Enter your full name');
    await expect(summary).toContainText('Enter your mobile number');
    await expect(summary).toContainText('Confirm that you agree to the terms');
    await summary.getByRole('link', { name: 'Enter your full name' }).click();
    await expect(page.getByLabel('Full name', { exact: true })).toBeFocused();
    await page.getByLabel('Full name', { exact: true }).fill('Ravi Kumar');
    await expect(summary).toContainText('Use a synthetic name');
  });

  test('creates an account after mobile OTP, signs the citizen in, and allows sign-in later', async ({
    page,
  }) => {
    const mobile = uniqueMobile();
    await open(page, '/register');
    await fillRegistration(page, mobile);
    await page.locator('label[for="preferred_language-hi"]').click();
    await page.getByRole('button', { name: 'Send OTP and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Verify your mobile number' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Account creation progress' })).toContainText(
      '1. Your details (completed)',
    );
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await page.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeFocused();
    await expect(page.getByTestId('account-summary')).toContainText('SAMPLE Asha Devi');
    await expect(page.getByTestId('account-summary')).toContainText('हिन्दी');
    await expect(page.getByRole('link', { name: 'Start application' })).toHaveAttribute(
      'href',
      '/services/IND-SOC-002/apply',
    );
    expect(await browserSession(page)).toMatchObject({
      authenticated: true,
      display_name: 'SAMPLE Asha Devi',
      preferred_language: 'hi',
    });

    await page.evaluate(() => fetch('/api/lab/session', { method: 'DELETE' }));
    expect(await browserSession(page)).toMatchObject({ authenticated: false });
    await open(page, '/login');
    await requestSignInOtp(page, mobile);
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/services`);
  });

  test('refuses to create a second account for a registered mobile', async ({ page }) => {
    await open(page, '/register');
    await fillRegistration(page, SEED_MOBILE);
    await page.getByRole('button', { name: 'Send OTP and continue' }).click();
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await page.getByRole('button', { name: 'Verify and create account' }).click();
    const alert = page.getByTestId('otp-blocking-error');
    await expect(alert).toContainText('An account already exists for this mobile number');
    await expect(alert.getByRole('link', { name: 'Sign in instead' })).toBeVisible();
  });
});

test.describe('citizen identity API failure paths (SAMPLE_LAB)', () => {
  test('rejects non-synthetic mobiles and malformed requests', async ({ request }) => {
    const real = await request.post(`${CITIZEN}/api/lab/otp/challenges`, {
      data: { mobile: '7012345678', purpose: 'SIGN_IN' },
    });
    expect(real.status()).toBe(400);
    expect(await real.json()).toMatchObject({
      error_code: 'SF-LAB-SESSION-MOBILE',
      field: 'mobile',
    });
    const noPurpose = await request.post(`${CITIZEN}/api/lab/otp/challenges`, {
      data: { mobile: SEED_MOBILE },
    });
    expect(noPurpose.status()).toBe(400);
    expect(await noPurpose.json()).toMatchObject({ error_code: 'SF-SYS-003' });
    const badCode = await request.post(`${CITIZEN}/api/lab/session`, {
      data: { challenge_id: 'x', code: '12' },
    });
    expect(badCode.status()).toBe(400);
  });

  test('locks a challenge after five wrong codes (SF-AUTH-001)', async ({ request }) => {
    const challenge_id = await apiChallenge(request, SEED_MOBILE, 'SIGN_IN');
    for (let remaining = 4; remaining >= 1; remaining -= 1) {
      const res = await request.post(`${CITIZEN}/api/lab/session`, {
        data: { challenge_id, code: '000000' },
      });
      expect(res.status()).toBe(401);
      expect(await res.json()).toMatchObject({
        error_code: 'SF-AUTH-001',
        reason: 'INVALID_CODE',
        attempts_remaining: remaining,
      });
    }
    const locked = await request.post(`${CITIZEN}/api/lab/session`, {
      data: { challenge_id, code: '000000' },
    });
    expect(await locked.json()).toMatchObject({ reason: 'LOCKED', attempts_remaining: 0 });
    const afterLock = await request.post(`${CITIZEN}/api/lab/session`, {
      data: { challenge_id, code: OTP },
    });
    expect(afterLock.status()).toBe(401);
    expect(await afterLock.json()).toMatchObject({ reason: 'LOCKED' });
  });

  test('binds challenges to their purpose and validates profiles before consuming the OTP', async ({
    request,
  }) => {
    const mobile = uniqueMobile();
    const profile = {
      display_name: 'Lab Citizen Two',
      mobile,
      email: '',
      preferred_language: 'en',
      consent: true,
    };
    const signInChallenge = await apiChallenge(request, mobile, 'SIGN_IN');
    const crossPurpose = await request.post(`${CITIZEN}/api/lab/accounts`, {
      data: { ...profile, challenge_id: signInChallenge, code: OTP },
    });
    expect(crossPurpose.status()).toBe(401);
    expect(await crossPurpose.json()).toMatchObject({ reason: 'PURPOSE_MISMATCH' });

    const registerChallenge = await apiChallenge(request, mobile, 'REGISTER');
    const realName = await request.post(`${CITIZEN}/api/lab/accounts`, {
      data: { ...profile, display_name: 'Real Person', challenge_id: registerChallenge, code: OTP },
    });
    expect(realName.status()).toBe(400);
    expect(await realName.json()).toMatchObject({
      field_errors: { display_name: expect.stringMatching(/synthetic/) },
    });
    const created = await request.post(`${CITIZEN}/api/lab/accounts`, {
      data: { ...profile, challenge_id: registerChallenge, code: OTP },
    });
    expect(created.status()).toBe(201);
    expect(created.headers()['set-cookie']).toContain('HttpOnly');
    expect(await created.json()).toMatchObject({ authenticated: true, auth_assurance: 'OTP' });
  });
});

test.describe('citizen auth accessibility (WCAG 2.1 AA, UX4G rule 6)', () => {
  for (const [name, path, title] of [
    ['sign in', '/login', 'Sign in - ServiceForm AI - Citizen Portal'],
    ['create account', '/register', 'Create account - ServiceForm AI - Citizen Portal'],
  ] as const) {
    test(`${name}: unique title, single h1, landmarks and no axe violations`, async ({ page }) => {
      await open(page, path);
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('complementary')).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`${name}: reflows at 320 CSS px without horizontal scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await open(page, path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('OTP step (incl. error state) has no axe violations and reflows at 320 px', async ({
    page,
  }) => {
    await open(page, '/login');
    await requestSignInOtp(page, SEED_MOBILE);
    await expectNoAxeViolations(page);
    await page.getByLabel('Digit 1 of 6').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText(/incorrect/)).toBeVisible();
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 320, height: 640 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('registration error summary and success screen have no axe violations', async ({ page }) => {
    await open(page, '/register');
    await page.getByRole('button', { name: 'Send OTP and continue' }).click();
    await expect(page.getByTestId('error-summary')).toBeVisible();
    await expectNoAxeViolations(page);
    await fillRegistration(page, uniqueMobile());
    await page.getByRole('button', { name: 'Send OTP and continue' }).click();
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await page.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
