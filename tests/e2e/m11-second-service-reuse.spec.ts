/**
 * M11 second-service reuse (SAMPLE_LAB) — Income remains SAMPLE_LAB_STUB (no invented statute).
 * SAMPLE_LAB placement may lab-offer the DRAFT form with SAMPLE_LAB DUMMY params.
 * CERTIFIED=false · G6=false · self_certified=false · DigiLocker SIMULATED.
 */
import { expect, test } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';
const STUDIO = 'http://127.0.0.1:3002';

test.describe('M11 second-service reuse — Income SAMPLE_LAB lab-offer', () => {
  test('citizen catalogue lists Income as offered in SAMPLE_LAB', async ({ page }) => {
    await page.goto(`${CITIZEN}/login?next=${encodeURIComponent('/services')}`);
    await page
      .getByLabel('Mobile number', { exact: true })
      .fill(`9${Date.now().toString().slice(-9)}`);
    await page.getByRole('button', { name: 'Get OTP' }).click();
    const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
    await expect(code).toHaveText(/^\d{6}$/);
    await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/services`);
    await expect(
      page.getByRole('link', { name: /Apply now for Income Certificate/ }),
    ).toBeVisible();
  });

  test('citizen apply for IND-SOC-031 loads the metadata form', async ({ page }) => {
    await page.goto(`${CITIZEN}/login?next=${encodeURIComponent('/services/IND-SOC-031/apply')}`);
    await page
      .getByLabel('Mobile number', { exact: true })
      .fill(`9${Date.now().toString().slice(-9)}`);
    await page.getByRole('button', { name: 'Get OTP' }).click();
    const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
    await expect(code).toHaveText(/^\d{6}$/);
    await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(`${CITIZEN}/services/IND-SOC-031/apply`);
    await expect(page.getByLabel('Full name (as per official record)')).toBeVisible();
    await expect(page.getByText(/SAMPLE/i).first()).toBeVisible();
  });

  test('Studio template catalogue exposes Income stub and forms designer entry', async ({
    page,
  }) => {
    await page.goto(`${STUDIO}/templates/ind-soc-031.income-certificate`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Income Certificate');
    await expect(
      page.getByText(/SAMPLE_LAB sample|SAMPLE_LAB DUMMY|SAMPLE_LAB stub|stub/i).first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Fee designer \(DUMMY ₹9\.99\)/i })).toBeVisible();
    await page.goto(`${STUDIO}/forms`);
    const incomeRow = page.getByRole('row', { name: /IND-SOC-031/ });
    await expect(incomeRow).toBeVisible();
    await expect(
      incomeRow.getByRole('link', { name: /Open Income Certificate \(individual\) in designer/i }),
    ).toBeVisible();
  });

  test('Studio Fee designer exposes Income SAMPLE_LAB DUMMY starter', async ({ page }) => {
    await page.goto(`${STUDIO}/fees`);
    await expect(
      page.getByRole('link', { name: /Income Certificate SAMPLE_LAB DUMMY fee/i }),
    ).toBeVisible();
    await page.goto(`${STUDIO}/fees/designer?template=ind-soc-031-dummy`);
    await expect(page.getByText(/SAMPLE_LAB DUMMY · Income Certificate fee/i)).toBeVisible();
    await expect(page.getByText(/Not statutory|SAMPLE_LAB DUMMY/i).first()).toBeVisible();
  });
});
