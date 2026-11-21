/**
 * SAMPLE_LAB representative certificate E2E: Residence re-smoke + 5 lab-offered stubs.
 * Citizen apply → officer approve → DigiLocker SIMULATED for each representative.
 * Full catalogue (159) form contract coverage lives in CMP-009 unit suite.
 * CERTIFIED=false · G6=false · DigiLocker SIMULATED · no invented statute.
 */
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const CITIZEN = 'http://127.0.0.1:3000';
const OFFICER = 'http://127.0.0.1:3001';

const REPRESENTATIVES = [
  'IND-SOC-002',
  'IND-SOC-031',
  'IND-SOC-001',
  'IND-CIV-001',
  'IND-AGR-002',
  'IND-EDU-004',
] as const;

const uniqueMobile = () => `9${randomInt(100_000_000, 1_000_000_000)}`;

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function citizenSignIn(page: Page, path: string): Promise<void> {
  await open(page, `${CITIZEN}/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel('Mobile number', { exact: true }).fill(uniqueMobile());
  await page.getByRole('button', { name: 'Get OTP' }).click();
  const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
  await expect(code).toHaveText(/^\d{6}$/);
  await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(`${CITIZEN}${path}`);
}

async function officerSignIn(page: Page): Promise<void> {
  await open(page, `${OFFICER}/login?next=${encodeURIComponent('/applications')}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${OFFICER}/applications`);
}

/** SAMPLE_LAB multi-desk: scrutiny HUMAN_TASK → Forward, then approving desk → Approve. */
async function officerCompleteMultiDeskApproval(page: Page): Promise<void> {
  const forward = page.getByRole('button', { name: 'Forward for approval' });
  const approve = page.getByRole('button', { name: 'Approve' });
  await expect(forward.or(approve)).toBeVisible({ timeout: 60_000 });
  if (await forward.isVisible()) {
    await forward.click();
    await expect(page.getByText(/Forwarded to the approving desk/i)).toBeVisible();
    await expect(approve).toBeVisible({ timeout: 60_000 });
  }
  await approve.click();
}

async function cookieFor(page: Page, name: string): Promise<string> {
  const cookies = await page.context().cookies();
  const hit = cookies.find((c) => c.name === name);
  if (!hit) throw new Error(`missing cookie ${name}`);
  return `${name}=${hit.value}`;
}

test.describe('SAMPLE_LAB certificate representatives — form load + submit API', () => {
  test.describe.configure({ timeout: 120_000, mode: 'serial' });

  for (const catalogueId of REPRESENTATIVES) {
    test(`${catalogueId}: form interpret + validation + submit success`, async ({ page }) => {
      await citizenSignIn(page, `/services/${catalogueId}/apply`);
      const cookie = await cookieFor(page, 'sf_citizen_session');

      const form = await page.request.get(`${CITIZEN}/api/portal/forms/${catalogueId}`, {
        headers: { cookie },
      });
      expect(form.status(), catalogueId).toBe(200);
      const body = (await form.json()) as {
        form: { pin: { form_key: string; version_id: string }; package: { json_schema: unknown } };
        prefill: Record<string, unknown>;
        interpretation: { required_fields: string[] };
        g6_issued: boolean;
      };
      expect(body.g6_issued).toBe(false);
      expect(body.form.pin.form_key).toMatch(/application|registration/);
      expect(body.interpretation.required_fields.length).toBeGreaterThan(0);

      const bad = await page.request.post(`${CITIZEN}/api/portal/applications`, {
        headers: { cookie },
        data: { catalogue_id: catalogueId, data: { declaration_accepted: false } },
      });
      expect(bad.status(), `${catalogueId} invalid`).toBe(422);

      const data = {
        ...body.prefill,
        declaration_accepted: true,
      };
      const submit = await page.request.post(`${CITIZEN}/api/portal/applications`, {
        headers: { cookie, 'idempotency-key': `rep-${catalogueId}-${randomInt(1e9)}` },
        data: { catalogue_id: catalogueId, data },
      });
      expect(submit.status(), `${catalogueId} submit ${await submit.text()}`).toBe(201);
      const created = (await submit.json()) as {
        application: { id: string; status: string; platform_state: string };
        g6_issued: boolean;
      };
      expect(created.g6_issued).toBe(false);
      expect(created.application.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(['SUBMITTED', 'ACTION_REQUIRED']).toContain(created.application.status);
      expect(['SUBMITTED', 'RECEIVED', 'UNDER_SCRUTINY', 'DECISION_PENDING']).toContain(
        created.application.platform_state,
      );
    });
  }
});

test.describe('SAMPLE_LAB certificate representatives — officer + DigiLocker SIM', () => {
  test.describe.configure({ timeout: 180_000, mode: 'serial' });

  for (const catalogueId of REPRESENTATIVES) {
    test(`${catalogueId}: citizen → officer approve → DigiLocker SIMULATED`, async ({
      browser,
    }) => {
      const citizen = await (await browser.newContext()).newPage();
      await citizenSignIn(citizen, `/services/${catalogueId}/apply`);
      const cookie = await cookieFor(citizen, 'sf_citizen_session');
      const form = await citizen.request.get(`${CITIZEN}/api/portal/forms/${catalogueId}`, {
        headers: { cookie },
      });
      expect(form.status()).toBe(200);
      const body = (await form.json()) as { prefill: Record<string, unknown> };
      const submit = await citizen.request.post(`${CITIZEN}/api/portal/applications`, {
        headers: { cookie, 'idempotency-key': `e2e-${catalogueId}-${randomInt(1e9)}` },
        data: {
          catalogue_id: catalogueId,
          data: { ...body.prefill, declaration_accepted: true },
        },
      });
      expect(submit.status(), await submit.text()).toBe(201);
      const app = (await submit.json()) as { application: { id: string } };
      const id = app.application.id;
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const officer = await (await browser.newContext()).newPage();
      await officerSignIn(officer);
      await open(officer, `${OFFICER}/applications/${id}`);
      await officerCompleteMultiDeskApproval(officer);
      await expect(officer.getByText(/published to DigiLocker \(SIMULATED\)/i)).toBeVisible({
        timeout: 60_000,
      });

      await open(citizen, `${CITIZEN}/certificates/${id}`);
      await expect(
        citizen.getByText(/DigiLocker · PUBLISHED|Saved to DigiLocker/i).first(),
      ).toBeVisible({ timeout: 60_000 });
      await citizen.close();
      await officer.close();
    });
  }
});
