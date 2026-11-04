/**
 * Citizen journey stitched to OTP sign-in (SAMPLE_LAB): gated routes, header account, pre-filled
 * application, per-citizen "My applications", sign-out. REQ: INT-001, DESIGN-SYSTEM.md rule 6.
 * OTP and DigiLocker are SIMULATED; G6 not issued.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';
const OTP = '123456';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const uniqueMobile = () => `9${randomInt(100_000_000, 1_000_000_000)}`;

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${CITIZEN}${path}`);
  await page.waitForLoadState('networkidle');
}

async function register(page: Page, name: string, mobile: string): Promise<void> {
  await open(page, '/register');
  await page.getByLabel('Full name', { exact: true }).fill(name);
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile);
  await page.locator('label[for="reg-consent"]').click();
  await page.getByRole('button', { name: 'Send OTP and continue' }).click();
  await page.getByLabel('Digit 1 of 6').fill(OTP);
  await page.getByRole('button', { name: 'Verify and create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
}

async function submitApplication(page: Page): Promise<string> {
  await open(page, '/services/IND-SOC-002/apply');
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: /Save & continue/i }).click();
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Submit application/i }).click();
  await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop() ?? '';
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('citizen journey stitched to OTP sign-in', () => {
  test('gated pages send anonymous visitors to sign in and bring them back', async ({ page }) => {
    await open(page, '/services/IND-SOC-002');
    await expect(page).toHaveURL(/\/login\?next=%2Fservices%2FIND-SOC-002$/);
    await page.getByLabel('Mobile number', { exact: true }).fill('9876543210');
    await page.getByRole('button', { name: 'Get OTP' }).click();
    await page.getByLabel('Digit 1 of 6').fill(OTP);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/services/IND-SOC-002`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Residence Certificate');
  });

  test('header shows the verified account and sign-out returns to sign in', async ({ page }) => {
    const mobile = uniqueMobile();
    await register(page, 'SAMPLE Header Citizen', mobile);
    const account = page.getByTestId('citizen-account');
    await expect(account).toContainText('SAMPLE Header Citizen');
    await expect(account).toContainText(`+91 ${mobile.slice(0, 5)} •••${mobile.slice(8)}`);
    await expect(page.getByRole('navigation', { name: 'Citizen' })).toContainText(
      'My applications',
    );
    await account.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login\?signed_out=1$/);
    await expect(page.getByTestId('signed-out-notice')).toContainText('You have signed out');
    await expect(page.getByTestId('citizen-account')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Citizen' })).toContainText('Sign in');
  });

  test('the application is pre-filled from the account and filed under that citizen only', async ({
    page,
  }) => {
    const mobileA = uniqueMobile();
    await register(page, 'SAMPLE Journey Alpha', mobileA);
    await open(page, '/services/IND-SOC-002/apply');
    await expect(page.getByLabel('Full name (as per official record)')).toHaveValue(
      'SAMPLE Journey Alpha',
    );
    await expect(page.getByLabel('Mobile number')).toHaveValue(mobileA);
    await expect(page.getByText('Verified by OTP at sign-in')).toBeVisible();

    const id = await submitApplication(page);
    await expect(page.getByText('Awaiting officer decision')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Application progress' })).toContainText(
      'Submitted (completed)',
    );
    await open(page, '/certificates');
    await expect(page.getByTestId('application-card')).toHaveCount(1);
    await expect(
      page.getByRole('link', { name: `View application ${id.slice(0, 8).toUpperCase()}` }),
    ).toBeVisible();
    await open(page, '/');
    await expect(page.getByRole('heading', { name: 'Your latest application' })).toBeVisible();

    await page.getByTestId('citizen-account').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/signed_out=1/);
    await register(page, 'SAMPLE Journey Beta', uniqueMobile());
    await open(page, '/certificates');
    await expect(page.getByTestId('applications-empty')).toBeVisible();
    await expect(page.getByTestId('application-card')).toHaveCount(0);
  });

  test('applications API refuses anonymous submit and anonymous "mine" listing', async ({
    request,
  }) => {
    const mine = await request.get(`${CITIZEN}/api/lab/applications?mine=1`);
    expect(mine.status()).toBe(401);
    expect(await mine.json()).toMatchObject({ error_code: 'SF-AUTH-001' });
    const submit = await request.post(`${CITIZEN}/api/lab/applications`, {
      data: { applicant_name: 'SAMPLE Anonymous' },
    });
    expect(submit.status()).toBe(401);
  });
});

test.describe('citizen journey accessibility (WCAG 2.1 AA, UX4G rule 6)', () => {
  test('signed-in journey pages have no axe violations and reflow at 320 px', async ({ page }) => {
    await register(page, 'SAMPLE Access Citizen', uniqueMobile());
    const id = await submitApplication(page);
    for (const path of [
      '/',
      '/services',
      '/services/IND-SOC-002',
      '/services/IND-SOC-002/apply',
      '/certificates',
      `/certificates/${id}`,
    ]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expectNoAxeViolations(page);
      await page.setViewportSize({ width: 320, height: 640 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows at 320 px`).toBeLessThanOrEqual(0);
    }
  });
});
