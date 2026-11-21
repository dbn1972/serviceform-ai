/**
 * SF-59 Studio Fee / SLA / Evidence / Credential designers (SAMPLE_LAB).
 * Parity with forms/workflow/rules: UX4G landing + designer, CMP-033 draft path.
 * CERTIFIED=false. G6=false. SAMPLE_LAB_DUMMY labels OK. No invented statute.
 * REQ: DESIGN-SYSTEM.md rule 6 (axe on landing).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const STUDIO = 'http://127.0.0.1:3002';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('Studio meta-kind designers', () => {
  test('fee designer template edits amount and shows schema hash', async ({ page }) => {
    await open(page, `${STUDIO}/fees`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fee designer');
    await expectAccessible(page);
    await page.getByRole('link', { name: /Transfer Certificate SAMPLE_LAB DUMMY fee/i }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Transfer Certificate');
    await page.getByRole('button', { name: /Edit fee line/i }).click();
    await page.getByLabel('Amount (minor units / paise)').fill('1999');
    await page.getByRole('tab', { name: 'Schema' }).click();
    await expect(page.getByTestId('fee-schema')).toContainText('1999');
    await expect(page.getByTestId('fee-schema')).toContainText('SAMPLE_LAB DUMMY');
  });

  test('sla / evidence / credential landings open templates', async ({ page }) => {
    await open(page, `${STUDIO}/sla`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('SLA designer');
    await page.getByRole('link', { name: /Residence Certificate SLA/i }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Residence Certificate SLA',
    );
    await expect(page.getByText('P10D').first()).toBeVisible();

    await open(page, `${STUDIO}/evidence`);
    await page.getByRole('link', { name: /Residence Certificate evidence/i }).click();
    await expect(page.getByText('proof_of_address').first()).toBeVisible();

    await open(page, `${STUDIO}/credentials`);
    await page.getByRole('link', { name: /Residence Certificate credential/i }).click();
    await expect(page.getByLabel('DigiLocker / wallet label')).toHaveValue(
      /SAMPLE_LAB_IND_SOC_002_RESIDENT/,
    );
  });
});
