/**
 * Certificate template catalogue (SAMPLE_LAB): Studio browse/select/version history/preview and
 * the citizen service catalogue. Residence is the published template; Income, Domicile and Birth
 * are stubs from docs/catalogue that citizens cannot apply for. Not CERTIFIED. G6 not issued.
 * REQ: M10 catalogue; DESIGN-SYSTEM.md rule 6 (axe, reflow); published versions immutable.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';
const STUDIO = 'http://127.0.0.1:3002';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function citizenSignIn(page: Page, path: string): Promise<void> {
  await open(page, `${CITIZEN}/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel('Mobile number', { exact: true }).fill(`9${randomInt(1e8, 1e9)}`);
  await page.getByRole('button', { name: 'Get OTP' }).click();
  const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
  await expect(code).toHaveText(/^\d{6}$/);
  await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(`${CITIZEN}${path}`);
  await page.waitForLoadState('networkidle');
}

test.describe('Studio template catalogue', () => {
  test('browse and filter versioned templates', async ({ page }) => {
    await open(page, `${STUDIO}/templates`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Certificate template catalogue',
    );
    const cards = page.getByRole('list', { name: 'Certificate templates' }).getByRole('article');
    await expect(cards).toHaveCount(4);
    await expect(page.locator('.sf-result-count')).toHaveText('4 of 4 templates');
    await page.getByLabel('Maturity').selectOption('SAMPLE_LAB_STUB');
    await expect(cards).toHaveCount(3);
    await page.getByLabel('Maturity').selectOption('ALL');
    await page.getByLabel('Search templates').fill('income');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('IND-SOC-031');
    await page.getByLabel('Search templates').fill('');
    await page.getByLabel('Category').selectOption('Civil Registration & Personal Identity');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Birth Registration');
    await page.getByLabel('Category').selectOption('ALL');
    await expectAccessible(page);
  });

  test('select a template: version history, diff, fields and live preview', async ({ page }) => {
    await open(page, `${STUDIO}/templates`);
    await page.getByRole('link', { name: 'Open Residence Certificate template' }).click();
    await expect(page).toHaveURL(`${STUDIO}/templates/ind-soc-002.residence-certificate`);
    await expect(page.getByText('Published to the SAMPLE_LAB citizen portal')).toBeVisible();
    const history = page.getByRole('table').filter({ hasText: 'Content hash' });
    await expect(history.getByRole('row')).toHaveCount(3);
    await expect(history.getByRole('row', { name: /1\.0\.0.*PUBLISHED/ })).toBeVisible();
    await expect(history.getByRole('row', { name: /1\.1\.0.*DRAFT/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Changes from v1.0.0' })).toBeVisible();
    await expect(page.locator('.sf-diff-list').first()).toHaveText(
      /^Added\s*Father's \/ mother's \/ guardian's name\s*\/guardian_name/,
    );

    const name = page.getByLabel('Full name (as per official record)');
    await expect(name).toHaveValue('');
    await page.getByRole('button', { name: 'Check this step' }).click();
    await expect(page.getByText('Enter the full name').first()).toBeVisible();
    await page.getByRole('button', { name: /^2\. Residence$/ }).click();
    await expect(page.getByLabel('PIN code')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Inspect version 1.0.0' }).click();
    await expect(page).toHaveURL(/\?v=1\.0\.0$/);
    await expect(page.getByRole('heading', { name: 'First version' })).toBeVisible();
    await expect(page.getByLabel('Full name (as per official record)')).toHaveValue(
      'SAMPLE Lab Citizen',
    );
  });

  test('a stub shows pending policy and no invented values', async ({ page }) => {
    await open(page, `${STUDIO}/templates/ind-soc-031.income-certificate`);
    await expect(page.getByText('SAMPLE_LAB stub — not offered to citizens')).toBeVisible();
    await expect(page.getByText('Policy input required')).toHaveCount(4);
    await expect(page.getByLabel('Annual income (₹)')).toHaveCount(0);
    await page.getByRole('button', { name: /^2\. Income$/ }).click();
    await expect(page.getByLabel('Annual income (₹)')).toBeVisible();
    await expectAccessible(page);
    const missing = await page.goto(`${STUDIO}/templates/not-a-template`);
    expect(missing?.status()).toBe(404);
  });
});

test.describe('citizen service catalogue', () => {
  test('offered services can be applied for; stubs are listed but not offered', async ({
    page,
  }) => {
    await citizenSignIn(page, '/services');
    const online = page.getByRole('list', { name: 'Services you can apply for' });
    await expect(online.getByRole('article')).toHaveCount(1);
    await expect(
      online.getByRole('link', { name: 'Apply now for Residence Certificate' }),
    ).toBeVisible();
    const upcoming = page.getByRole('list', { name: 'Services not yet available' });
    await expect(upcoming.getByRole('article')).toHaveCount(3);
    await expect(upcoming.getByRole('link', { name: /^Apply now/ })).toHaveCount(0);
    await page.getByLabel('Search services').fill('birth');
    await expect(upcoming.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('No online service matches your search.')).toBeVisible();
    await page.getByLabel('Search services').fill('');
    await expectAccessible(page);

    await upcoming
      .getByRole('link', { name: 'View details of Income Certificate (individual)' })
      .click();
    await expect(page).toHaveURL(`${CITIZEN}/services/IND-SOC-031`);
    await expect(
      page.getByText('You cannot apply for this service in this portal yet'),
    ).toBeVisible();
    await expect(page.getByText('To be published by the department').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Start application/ })).toHaveCount(0);
    await expect(page.getByText('Annual income (₹)')).toBeVisible();
    await expectAccessible(page);

    const apply = await page.goto(`${CITIZEN}/services/IND-SOC-031/apply`);
    expect(apply?.status()).toBe(404);
    const unknown = await page.goto(`${CITIZEN}/services/IND-NOPE-000`);
    expect(unknown?.status()).toBe(404);
  });
});
