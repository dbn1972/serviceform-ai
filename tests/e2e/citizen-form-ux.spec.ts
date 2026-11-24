/**
 * World-class forms WS1: citizen apply UX on the SAMPLE_LAB platform path. Save and resume on a
 * CMP-015 DRAFT (working data), error summary and field errors, keyboard, phone reflow and axe.
 * Requires `scripts/dev/platform-lab.sh up`. OTP/DigiLocker SIMULATED. Not CERTIFIED. G6=false.
 * REQ: CCR-M10-001 (working data while DRAFT), CCR-M10-002 (CMP-009 authoritative),
 * Phase A L-2 (synthetic names), DESIGN-SYSTEM.md rule 6, WCAG 2.1 AA + 2.4.11.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { uploadEvidenceOnWizard } from './helpers/evidence-upload';

const CITIZEN = 'http://127.0.0.1:3000';
const APPLY = '/services/IND-SOC-002/apply';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const uniqueMobile = () => `9${randomInt(100_000_000, 1_000_000_000)}`;

async function signIn(page: Page, path = APPLY): Promise<void> {
  await page.goto(`${CITIZEN}/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel('Mobile number', { exact: true }).fill(uniqueMobile());
  await page.getByRole('button', { name: 'Get OTP' }).click();
  const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
  await expect(code).toHaveText(/^\d{6}$/);
  await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(`${CITIZEN}${path}`);
}

async function cookie(page: Page): Promise<string> {
  const found = (await page.context().cookies()).find((c) => c.name === 'sf_citizen_session');
  expect(found).toBeDefined();
  return `sf_citizen_session=${found?.value ?? ''}`;
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    label,
  ).toEqual([]);
}

/** Elements inside <main> that extend past the viewport (clipped content, not only page scroll). */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('main *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > width + 0.5;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`)
      .slice(0, 5);
  });
}

const stepHeading = (page: Page) => page.locator('#sf-step-heading');
const saveStatus = (page: Page) => page.getByTestId('save-status');

test.describe('save and resume on a CMP-015 draft', () => {
  test.describe.configure({ timeout: 120_000 });

  test('save and come back later → My applications → continue → submit files that same application', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByLabel('Full name (as per official record)').fill('SAMPLE Resume Citizen');
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await expect(stepHeading(page)).toContainText('Step 2 of 4');
    await expect(saveStatus(page)).toContainText(/Saved/);
    await expect(page).toHaveURL(/\/apply\?draft=[0-9a-f-]{36}$/);
    const draftId = new URL(page.url()).searchParams.get('draft') ?? '';

    await page.getByRole('button', { name: 'Save and come back later' }).click();
    const notice = page.getByTestId('apply-notice');
    await expect(notice).toContainText('Saved');
    await expect(notice).toContainText(`Ref ${draftId.slice(0, 8).toUpperCase()}`);
    await expect(notice).toBeFocused();

    await page.goto(`${CITIZEN}/certificates`);
    const card = page.getByTestId('application-card');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-status', 'DRAFT');
    await expect(card).toContainText('Residence Certificate');
    await expect(card).toContainText('Saved draft · not submitted yet');
    await expectNoAxeViolations(page, 'my applications with a draft');
    await card.getByRole('link', { name: /Continue Residence Certificate application/ }).click();

    await expect(page).toHaveURL(`${CITIZEN}${APPLY}?draft=${draftId}`);
    await expect(page.getByTestId('apply-notice')).toContainText('Welcome back');
    // Applicant and Residence are complete; Evidence still needs an upload.
    await expect(stepHeading(page)).toContainText('Step 3 of 4');
    await expect(stepHeading(page)).toContainText('Supporting evidence');
    await expectNoAxeViolations(page, 'resumed apply');
    await uploadEvidenceOnWizard(page);
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await expect(
      page.getByRole('definition').filter({ hasText: 'SAMPLE Resume Citizen' }),
    ).toBeVisible();
    await expect(
      page.getByRole('definition').filter({ hasText: 'sample-evidence.pdf' }),
    ).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Submit application/i }).click();

    await expect(page).toHaveURL(`${CITIZEN}/certificates/${draftId}`);
    const list = await page.request.get(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie: await cookie(page) },
    });
    const apps = ((await list.json()) as { applications: { id: string; status: string }[] })
      .applications;
    expect(apps.map((a) => [a.id, a.status])).toEqual([[draftId, 'SUBMITTED']]);
  });

  test('NEGATIVE: another citizen cannot read, save over or resume a draft (IDOR)', async ({
    browser,
  }) => {
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner);
    const created = await owner.request.post(`${CITIZEN}/api/portal/drafts`, {
      headers: {
        cookie: await cookie(owner),
        'idempotency-key': `e2e${randomInt(1e9)}abcdefghijklmn`,
      },
      data: { catalogue_id: 'IND-SOC-002', data: { applicant_name: 'SAMPLE Owner Citizen' } },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { draft: { application_id: string } }).draft
      .application_id;

    const other = await (await browser.newContext()).newPage();
    await signIn(other);
    const otherCookie = await cookie(other);
    const read = await other.request.get(`${CITIZEN}/api/portal/drafts/${id}`, {
      headers: { cookie: otherCookie },
    });
    expect(read.status()).toBe(404);
    const write = await other.request.put(`${CITIZEN}/api/portal/drafts/${id}`, {
      headers: { cookie: otherCookie },
      data: {
        catalogue_id: 'IND-SOC-002',
        data: { applicant_name: 'SAMPLE Intruder' },
        expected_revision: 1,
      },
    });
    expect(write.status()).toBe(404);
    await other.goto(`${CITIZEN}${APPLY}?draft=${id}`);
    await expect(other.getByTestId('apply-notice')).toContainText('Saved application not found');
    await expect(other.getByLabel('Full name (as per official record)')).not.toHaveValue(
      'SAMPLE Owner Citizen',
    );

    const mine = await owner.request.get(`${CITIZEN}/api/portal/drafts/${id}`, {
      headers: { cookie: await cookie(owner) },
    });
    expect(await mine.json()).toMatchObject({
      draft: { revision: 1, data: { applicant_name: 'SAMPLE Owner Citizen' } },
    });
    await owner.close();
    await other.close();
  });

  test('NEGATIVE: a draft for one service cannot be saved under another, and anonymous saves are refused', async ({
    page,
    request,
  }) => {
    expect(
      (
        await request.post(`${CITIZEN}/api/portal/drafts`, {
          data: { catalogue_id: 'IND-SOC-002', data: {} },
        })
      ).status(),
    ).toBe(401);
    await signIn(page);
    const headers = {
      cookie: await cookie(page),
      'idempotency-key': `e2e${randomInt(1e9)}opqrstuvwxyzab`,
    };
    const created = await page.request.post(`${CITIZEN}/api/portal/drafts`, {
      headers,
      data: { catalogue_id: 'IND-SOC-002', data: { applicant_name: 'SAMPLE Residence Draft' } },
    });
    const id = ((await created.json()) as { draft: { application_id: string } }).draft
      .application_id;
    const crossService = await page.request.put(`${CITIZEN}/api/portal/drafts/${id}`, {
      headers,
      data: { catalogue_id: 'IND-SOC-031', data: {}, expected_revision: 1 },
    });
    expect(crossService.status()).toBe(404);
    const stale = await page.request.put(`${CITIZEN}/api/portal/drafts/${id}`, {
      headers,
      data: {
        catalogue_id: 'IND-SOC-002',
        data: { applicant_name: 'SAMPLE Later' },
        expected_revision: 0,
      },
    });
    expect(stale.status()).toBe(409);
  });

  test('NEGATIVE: SAMPLE_LAB refuses a non-synthetic name on save; nothing is stored', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByLabel('Full name (as per official record)').fill('Real Person');
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await expect(page.getByTestId('error-summary')).toBeFocused();
    await expect(stepHeading(page)).toContainText('Step 1 of 4');
    await expect(page.getByLabel('Full name (as per official record)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(saveStatus(page)).toContainText('Not saved');
    const list = await page.request.get(`${CITIZEN}/api/portal/applications`, {
      headers: { cookie: await cookie(page) },
    });
    expect(((await list.json()) as { applications: unknown[] }).applications).toEqual([]);
  });
});

test.describe('errors, keyboard and focus (WCAG 2.1 AA, 2.4.11)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('Enter continues; the error summary links to a field the sticky bar does not cover', async ({
    page,
  }) => {
    await signIn(page);
    const name = page.getByLabel('Full name (as per official record)');
    await name.fill('');
    await name.press('Enter');
    const summary = page.getByTestId('error-summary');
    await expect(summary).toBeFocused();
    await expect(page).toHaveTitle(/^Error: Applicant details \(step 1 of 4\)/);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#applicant_name-error')).toHaveText('Error: Enter the full name');

    await page.keyboard.press('Tab');
    await expect(summary.getByRole('link', { name: 'Enter the full name' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(name).toBeFocused();
    const field = await name.boundingBox();
    const bar = await page.locator('.sf-wizard-actions').boundingBox();
    expect(field && bar && field.y + field.height <= bar.y).toBe(true);
    expect(field && field.y >= 0).toBe(true);

    // Fixed answers clear at once ("reward early"); the summary goes with the last error.
    await name.fill('SAMPLE Keyboard Citizen');
    await expect(name).toHaveAttribute('aria-invalid', 'false');
    await expect(summary).toHaveCount(0);
    await name.press('Enter');
    await expect(stepHeading(page)).toBeFocused();
    await expect(stepHeading(page)).toContainText('Residence address');
    await expect(page).toHaveTitle(/^Residence address \(step 2 of 4\)/);

    const steps = page.getByRole('navigation', { name: 'Application steps' }).getByRole('button');
    await expect(steps.nth(0)).toContainText('Completed');
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(steps.nth(3)).toBeDisabled();
    await steps.nth(0).click();
    await expect(stepHeading(page)).toContainText('Applicant details');
    await expect(name).toHaveValue('SAMPLE Keyboard Citizen');
  });

  test('a format error shows when the citizen leaves the field and clears when fixed', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('button', { name: /Save & continue/i }).click();
    const pin = page.getByLabel('PIN code');
    await pin.fill('7510');
    await expect(pin).toHaveAttribute('aria-invalid', 'false');
    await pin.press('Tab');
    await expect(pin).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('PIN code must be 6 digits')).toBeVisible();
    await expect(page.getByTestId('error-summary')).toHaveCount(0);
    await pin.fill('751001');
    await expect(pin).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByText('PIN code must be 6 digits')).toHaveCount(0);
  });

  test('Evidence asks for an upload with a linked error; Change returns to the preview', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await expect(page.getByLabel('File name')).toHaveCount(0);
    await expect(page.getByLabel('MIME type')).toHaveCount(0);
    await page.getByRole('button', { name: /Save & continue/i }).click();
    const link = page.getByTestId('error-summary').getByRole('link');
    await expect(link).toHaveText(/Upload a supporting document/);
    await link.click();
    await expect(page.getByLabel('Upload supporting evidence')).toBeFocused();
    await uploadEvidenceOnWizard(page);
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await page.getByRole('button', { name: 'Change residence details' }).click();
    await expect(stepHeading(page)).toContainText('Residence address');
    await page.getByLabel('Post office').fill('SAMPLE Changed PO');
    await page.getByRole('button', { name: 'Save & return to preview' }).click();
    await expect(stepHeading(page)).toContainText('Preview application');
    await expect(
      page.getByRole('definition').filter({ hasText: 'SAMPLE Changed PO' }),
    ).toBeVisible();
  });
});

test.describe('phone reflow and accessibility on every step', () => {
  test.describe.configure({ timeout: 120_000 });

  test('320 px: no clipped controls, step names available to assistive tech, axe clean', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await signIn(page);
    const steps = page.getByRole('navigation', { name: 'Application steps' }).getByRole('button');
    await expect(steps).toHaveText([/Applicant/, /Residence/, /Evidence/, /Preview/]);
    for (const [index, title] of [
      'Applicant details',
      'Residence address',
      'Supporting evidence',
      'Preview application',
    ].entries()) {
      await expect(stepHeading(page)).toContainText(title);
      if (index > 0) await expect(saveStatus(page)).toContainText(/Saved/);
      expect(await clipped(page), title).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
        title,
      ).toBe(false);
      await expectNoAxeViolations(page, title);
      if (index === 2) await uploadEvidenceOnWizard(page);
      if (index < 3) await page.getByRole('button', { name: /Save & continue/i }).click();
    }
    await page.getByRole('button', { name: /Submit application/i }).click();
    await expect(page.getByTestId('error-summary')).toBeFocused();
    expect(await clipped(page)).toEqual([]);
    await expectNoAxeViolations(page, 'preview with errors');
  });
});
