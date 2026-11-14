/**
 * M11 second-service reuse (SAMPLE_LAB) — config path without inventing Income statute.
 * Income (IND-SOC-031) stays gated; Studio can open the catalogue stub; citizen apply 404s.
 * CERTIFIED=false · G6=false · self_certified=false · DigiLocker SIMULATED.
 */
import { expect, test } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';
const STUDIO = 'http://127.0.0.1:3002';

test.describe('M11 second-service reuse — Income gated + Studio config path', () => {
  test('citizen catalogue lists Income as not offered', async ({ page }) => {
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
    await expect(page.getByText('Income Certificate (individual)')).toBeVisible();
    await expect(page.getByText('Not yet offered here').first()).toBeVisible();
  });

  test('citizen apply for IND-SOC-031 is not found (gated)', async ({ page }) => {
    await page.goto(`${CITIZEN}/services/IND-SOC-031/apply`);
    // Unauthenticated → login, then after session the apply page 404s because not offered.
    if (page.url().includes('/login')) {
      await page
        .getByLabel('Mobile number', { exact: true })
        .fill(`9${Date.now().toString().slice(-9)}`);
      await page.getByRole('button', { name: 'Get OTP' }).click();
      const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
      await expect(code).toHaveText(/^\d{6}$/);
      await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
    }
    await expect(page.getByText(/404|not found|could not|Not Found/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Studio template catalogue exposes Income stub and forms designer entry', async ({
    page,
  }) => {
    await page.goto(`${STUDIO}/templates/ind-soc-031.income-certificate`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Income Certificate');
    await expect(
      page.getByText(/POLICY_INPUT_REQUIRED|policy input pending|stub/i).first(),
    ).toBeVisible();
    await page.goto(`${STUDIO}/forms`);
    const incomeRow = page.getByRole('row', { name: /IND-SOC-031/ });
    await expect(incomeRow).toBeVisible();
    await expect(
      incomeRow.getByRole('link', { name: /Open Income Certificate \(individual\) in designer/i }),
    ).toBeVisible();
  });
});
