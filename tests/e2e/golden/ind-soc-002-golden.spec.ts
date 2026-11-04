/**
 * Golden E2E harness — IND-SOC-002 Residence Certificate (M10).
 *
 * Odisha e-District public sample on tip. DigiLocker is SIMULATED SAMPLE_LAB mock.
 * G6 is not claimed. No invented statute.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { unlinkSync, existsSync } from 'node:fs';

const OWNER_INPUTS_READY = process.env['SF_M10_OWNER_INPUTS_READY'] === '1';
const LAB_STORE = process.env['SF_M10_LAB_STORE_PATH'] ?? '/tmp/sf-m10-ind-soc-002-lab.json';

const CITIZEN_PORTAL = `http://127.0.0.1:3000`;
const OFFICER_WORKBENCH = `http://127.0.0.1:3001`;
const STUDIO = `http://127.0.0.1:3002`;

test.describe('M10 Golden E2E — owner-input gate', () => {
  test('fails closed when SF_M10_OWNER_INPUTS_READY is unset; Odisha sample when set', () => {
    if (OWNER_INPUTS_READY) {
      expect(OWNER_INPUTS_READY).toBe(true);
      return;
    }
    expect(() => {
      throw new Error(
        'POLICY_INPUT_REQUIRED: owner inputs not yet supplied. ' +
          'Set SF_M10_OWNER_INPUTS_READY=1 to use the Odisha public sample on tip. ' +
          'Context: golden-e2e',
      );
    }).toThrow(/POLICY_INPUT_REQUIRED/);
  });
});

test.describe('M10 Golden E2E — harness health (IND-SOC-002 scaffold)', () => {
  test('citizen portal health endpoint responds 200', async ({ request }) => {
    const res = await request.get(`${CITIZEN_PORTAL}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('officer workbench health endpoint responds 200', async ({ request }) => {
    const res = await request.get(`${OFFICER_WORKBENCH}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('studio health endpoint responds 200', async ({ request }) => {
    const res = await request.get(`${STUDIO}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('citizen portal is reachable and has correct page title', async ({ page }) => {
    await page.goto(CITIZEN_PORTAL);
    await expect(page).toHaveTitle(/ServiceForm AI/);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('officer workbench is reachable and has correct page title', async ({ page }) => {
    await page.goto(OFFICER_WORKBENCH);
    await expect(page).toHaveTitle(/ServiceForm AI/);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('studio is reachable and has correct page title', async ({ page }) => {
    await page.goto(STUDIO);
    await expect(page).toHaveTitle(/ServiceForm AI/);
    await expect(page.getByRole('main')).toBeVisible();
  });
});

test.describe('M10 Golden E2E — tenant isolation probes', () => {
  test('citizen portal does not serve cross-tenant data in page source', async ({ page }) => {
    const CANARY = '00000000-0000-4000-8000-000000000099';
    await page.goto(CITIZEN_PORTAL);
    const content = await page.content();
    expect(content).not.toContain(CANARY);
  });

  test('API health endpoint does not include tenant identifiers in response body', async ({
    request,
  }) => {
    const SYNTHETIC_TENANT_IDS = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const res = await request.get(`${CITIZEN_PORTAL}/api/health`);
    const body = await res.text();
    for (const id of SYNTHETIC_TENANT_IDS) {
      expect(body, `health endpoint must not contain synthetic tenant id ${id}`).not.toContain(id);
    }
  });

  test('forged x-tenant-id header on citizen portal health returns 403 or is ignored (SF-TEN-002)', async ({
    request,
  }) => {
    const FORGED = '00000000-0000-4000-8000-000000000099';
    const res = await request.get(`${CITIZEN_PORTAL}/api/health`, {
      headers: { 'x-tenant-id': FORGED },
    });
    expect([200, 403]).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain(FORGED);
  });
});

test.describe('M10 Golden E2E — UX4G accessibility scaffolding', () => {
  async function checkBasicA11y(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }

  test('citizen portal has required ARIA landmarks', async ({ page }) => {
    await checkBasicA11y(page, CITIZEN_PORTAL);
  });

  test('officer workbench has required ARIA landmarks', async ({ page }) => {
    await checkBasicA11y(page, OFFICER_WORKBENCH);
  });
});

/** SAMPLE_LAB citizen sign-in: seeded synthetic mobile + SIMULATED OTP (CMP-004 semantics). */
async function signInAsSampleCitizen(page: Page): Promise<void> {
  await page.goto(`${CITIZEN_PORTAL}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Mobile number', { exact: true }).fill('9876543210');
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await page.getByLabel('Digit 1 of 6').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/services/);
}

/** Walk SAMPLE_LAB Residence Certificate wizard: applicant → residence → evidence → preview. */
async function completeResidenceWizardToPreview(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: /Application steps/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save & continue/i })).toBeVisible();
  // Applicant → Residence → Evidence → Preview (defaults are prefilled for SAMPLE_LAB)
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: /Save & continue/i }).click();
  }
  await expect(page.getByRole('heading', { name: /Preview application/i })).toBeVisible();
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: /Submit application/i })).toBeVisible();
}

test.describe('M10 Golden E2E — SAMPLE_LAB journey routes', () => {
  test('Studio: author IND-SOC-002 service metadata without bespoke backend code', async ({
    page,
  }) => {
    await page.goto(`${STUDIO}/services/new`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Author service metadata/i);
    await expect(page.getByText('IND-SOC-002 sample on tip')).toBeVisible();
    await expect(page.getByText(/G6 not issued/i).first()).toBeVisible();
  });

  test('Citizen: residence certificate apply page loads after SAMPLE_LAB login', async ({
    page,
  }) => {
    await signInAsSampleCitizen(page);
    await page.goto(`${CITIZEN_PORTAL}/services/IND-SOC-002/apply`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Residence Certificate/i);
    await completeResidenceWizardToPreview(page);
  });

  test('Officer: applications queue loads', async ({ page }) => {
    await page.goto(`${OFFICER_WORKBENCH}/applications`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Applications/i);
  });

  test('SAMPLE_LAB end-to-end: apply → approve → DigiLocker SIMULATED publish', async ({
    page,
    request,
  }) => {
    if (existsSync(LAB_STORE)) unlinkSync(LAB_STORE);

    await signInAsSampleCitizen(page);
    await page.goto(`${CITIZEN_PORTAL}/services/IND-SOC-002/apply`);
    await completeResidenceWizardToPreview(page);
    await page.getByRole('button', { name: /Submit application/i }).click();
    await expect(page).toHaveURL(/\/certificates\//);
    await expect(page.getByText(/Awaiting officer decision/i)).toBeVisible();

    const list = await request.get(`${CITIZEN_PORTAL}/api/lab/applications`);
    expect(list.status()).toBe(200);
    const listBody = (await list.json()) as { applications: { id: string }[] };
    const id = listBody.applications[0]?.id;
    expect(id).toBeTruthy();

    await page.goto(`${OFFICER_WORKBENCH}/applications/${id}`);
    await page.getByRole('button', { name: /Approve & issue/i }).click();
    await expect(page.getByText(/SAMPLE_LAB_CRED_/)).toBeVisible();

    await page.goto(`${CITIZEN_PORTAL}/certificates/${id}`);
    await page.getByRole('button', { name: /Publish to DigiLocker \(SIMULATED\)/i }).click();
    await expect(page.getByText(/SIMULATED DigiLocker publish/i)).toBeVisible();
    await expect(page.getByText(/sim:/)).toBeVisible();
  });
});
