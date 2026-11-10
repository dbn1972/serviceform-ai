/**
 * Phase C-1 Studio forms designer (SAMPLE_LAB): author a form visually, preview it through the
 * citizen UX4G renderer, save/validate/freeze it in CMP-033, resolve the hash pin through CMP-009,
 * and take a TenantServiceBinding change through CMP-051 maker-checker to a CMP-052 publish.
 * Officers are SIMULATED (CMP-004). Not CERTIFIED. G6 not issued. TSB seal not claimed.
 * REQ: Constitution §1, §8, §9, §30; DESIGN-SYSTEM.md rule 6 (axe, reflow, keyboard).
 */
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const STUDIO = 'http://127.0.0.1:3002';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const DESIGNER = 'sample-lab-studio-designer-1';
const CHECKER = 'sample-lab-studio-checker-1';
const PIN_KINDS = [
  'service',
  'offering',
  'form',
  'rules',
  'evidence',
  'fee',
  'workflow',
  'sla',
  'access',
  'credential',
  'notification',
  'authorization_policy',
] as const;

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function signIn(page: Page, subject: string): Promise<void> {
  const res = await page.request.post(`${STUDIO}/api/session`, { data: { subject } });
  expect(res.status()).toBe(201);
}

/**
 * Platform call from inside the Studio page, so the browser sends the session cookie exactly as
 * the UI does (the cookie is `Secure`; Chromium treats 127.0.0.1 as a secure context).
 */
async function studioFetch(
  page: Page,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ path, body, headers }) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      return {
        status: res.status,
        body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
      };
    },
    { path, body, headers },
  );
}

/** Test-only base binding: non-form pins are synthetic SAMPLE_LAB references, never policy. */
async function createBaseBinding(page: Page, tag: string): Promise<string> {
  const pins = Object.fromEntries(
    PIN_KINDS.map((kind) => [
      kind,
      {
        version_ref: `sample-lab-e2e.${kind}.${tag}`,
        content_hash: `sha256:${createHash('sha256').update(`e2e:${kind}:${tag}`).digest('hex')}`,
      },
    ]),
  );
  const res = await studioFetch(
    page,
    '/api/platform/tenant-service-bindings',
    {
      binding_key: `ind-soc-002.e2e-${tag}`,
      offering_ref: 'IND-SOC-002',
      metadata_bundle_ref: `sample-lab.e2e.${tag}`,
      pins,
    },
    { 'Idempotency-Key': randomUUID() },
  );
  expect(res.status).toBe(201);
  return String(res.body['binding_id']);
}

test.describe('Studio forms designer', () => {
  test('author a form from the palette, add a conditional rule and preview it', async ({
    page,
  }) => {
    await open(page, `${STUDIO}/forms`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Forms designer');
    await expectAccessible(page);
    await page.getByRole('link', { name: 'New blank form' }).click();
    await expect(page).toHaveURL(`${STUDIO}/forms/designer`);

    await page.getByLabel('Title', { exact: true }).fill('Trade licence application');
    await page.getByLabel('Form key', { exact: true }).fill('lab.trade-licence.application');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trade licence application');

    await page.getByRole('button', { name: 'Add Full name' }).click();
    await expect(page.getByLabel('Data key')).toHaveValue('applicant_name');
    await expect(page.getByText('SF-SEM-PERSON-FULL-NAME').first()).toBeVisible();
    await page.getByRole('button', { name: 'Add Date of birth' }).click();
    await page.getByRole('button', { name: 'Add Dropdown' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Business type');
    await page.getByLabel('Data key').fill('business_type');
    await page.getByLabel('Option 1 label').fill('Shop');
    await page.getByLabel('Option 1 stored value').fill('SHOP');
    await page.getByLabel('Option 2 label').fill('Workshop');
    await page.getByLabel('Option 2 stored value').fill('WORKSHOP');

    await page.getByRole('button', { name: 'Add Short text' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Workshop licence number');
    await page.getByLabel('Data key').fill('workshop_licence_no');
    await page.getByText('Show or hide based on another answer').click();
    await page.getByLabel('Answer to').selectOption('business_type');
    await page.getByLabel('Is', { exact: true }).selectOption('WORKSHOP');
    await page.getByLabel('Allowed characters').selectOption('upper_alnum');
    await page.getByLabel('Try a value').fill('WS1234');
    await expect(page.getByRole('status').filter({ hasText: 'Accepted' })).toBeVisible();

    await page.getByRole('button', { name: 'Add step' }).click();
    await page.getByLabel('Name in the stepper').fill('Declaration');
    await page.getByText('Review step (shows every answer before submit)').click();
    await page.getByRole('button', { name: 'Add Applicant declaration' }).click();
    await expect(page.getByRole('button', { name: /^No errors/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Applicant' }).click();
    const fields = page.getByRole('list', { name: 'Fields' }).first().getByRole('listitem');
    await expect(fields).toHaveCount(4);
    await page.getByRole('button', { name: 'Move Workshop licence number up' }).click();
    await expect(fields.nth(2)).toContainText('Workshop licence number');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(fields.nth(3)).toContainText('Workshop licence number');
    await expectAccessible(page);

    await page
      .getByRole('tablist', { name: 'Designer views' })
      .getByRole('tab', { name: 'Preview' })
      .click();
    await expect(page.getByLabel('Workshop licence number')).toHaveCount(0);
    await page.getByLabel('Business type').selectOption('WORKSHOP');
    await expect(page.getByLabel('Workshop licence number')).toBeVisible();
    await page.getByRole('button', { name: 'Check and continue' }).click();
    await expect(page.getByText('answer(s) need attention')).toBeVisible();
    await page.getByRole('button', { name: 'Phone (360 px)' }).click();
    await expectAccessible(page);

    await page
      .getByRole('tablist', { name: 'Designer views' })
      .getByRole('tab', { name: 'Schema' })
      .click();
    await expect(page.getByTestId('designer-content-hash')).toHaveText(/^sha256:[0-9a-f]{64}$/);
    await expect(page.getByRole('region', { name: 'JSON Schema (validation)' })).toContainText(
      '"workshop_licence_no"',
    );
    await expect(page.getByRole('region', { name: 'UI schema (UX4G layout)' })).toContainText(
      '"effect": "SHOW"',
    );
  });

  test('freeze a form version, resolve its pin in CMP-009 and publish through maker-checker', async ({
    page,
  }) => {
    const tag = `${Date.now().toString(36)}${randomInt(1e3, 1e4)}`;
    await signIn(page, DESIGNER);
    await open(page, `${STUDIO}/forms/designer?template=ind-soc-002.residence-certificate&v=1.1.0`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Residence Certificate application',
    );
    await page.getByLabel('Version', { exact: true }).fill(`1.${randomInt(2, 9999)}.0`);
    await page.getByRole('button', { name: 'Add Short text' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Ward number');
    await page.getByLabel('Data key').fill('ward_number');

    await page
      .getByRole('tablist', { name: 'Designer views' })
      .getByRole('tab', { name: 'Publish' })
      .click();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByTestId('designer-document-status')).toHaveText('DRAFT');
    const documentId = (await page.getByTestId('designer-document-id').textContent()) ?? '';
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    await expect(page.getByTestId('designer-document-status')).toHaveText('VALIDATED');
    await page.getByText('I understand this version becomes immutable.').click();
    await page.getByRole('button', { name: 'Freeze version' }).click();
    await expect(page.getByTestId('designer-document-status')).toHaveText(
      'FROZEN (CMP-033 PUBLISHED)',
    );
    await expect(page.getByTestId('designer-status')).toHaveText('FROZEN');
    await page.getByRole('button', { name: 'Resolve in CMP-009' }).click();
    await expect(page.getByTestId('designer-cmp009-result')).toContainText('controls');
    await expect(page.getByTestId('designer-cmp009-result')).toContainText(
      'client validation authoritative: false',
    );

    const baseId = await createBaseBinding(page, tag);
    await page.getByLabel('TenantServiceBinding id to update').fill(baseId);
    await page.getByRole('button', { name: 'Load binding' }).click();
    await expect(page.getByRole('row', { name: /form New/ })).toContainText(documentId);
    await page
      .getByLabel('Reason for the change (shown to the checker)')
      .fill('SAMPLE_LAB: add optional ward number (synthetic test)');
    await page.getByRole('button', { name: 'Create binding draft and submit for review' }).click();
    const submitted = page.getByTestId('designer-publication-request');
    await expect(submitted).toBeVisible();
    await expect(page.getByText('Publication request SUBMITTED')).toBeVisible();
    const requestId = (await submitted.locator('code').first().textContent()) ?? '';
    await expectAccessible(page);

    await open(page, `${STUDIO}/publication?request=${requestId}`);
    await expect(page.getByTestId('publication-status')).toHaveText('SUBMITTED');
    await expect(page.getByText('Maker cannot decide')).toBeVisible();

    await signIn(page, CHECKER);
    await open(page, `${STUDIO}/publication?request=${requestId}`);
    await expect(page.getByTestId('publication-status')).toHaveText('SUBMITTED');
    await page.getByLabel('Decision reason (recorded in the audit trail)').fill('Checked in lab');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('publication-status')).toHaveText('APPROVED');
    await page.getByRole('button', { name: 'Publish binding version' }).click();
    await expect(page.getByTestId('binding-published')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Inspect the pinned form (read-only)' }).click();
    await expect(page.getByText(/Version 1\.\d+\.0 is frozen/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Short text' })).toBeDisabled();
  });

  test('refuses unknown pins, tampered hashes, forged tenant headers and unsigned calls', async ({
    page,
  }) => {
    const anonymous = await page.request.post(`${STUDIO}/api/platform/interpretations`, {
      data: { form: {}, data: {}, locale: 'en-IN' },
    });
    expect(anonymous.status()).toBe(401);
    await signIn(page, DESIGNER);
    await open(page, `${STUDIO}/forms`);
    const unknown = await studioFetch(page, '/api/platform/interpretations', {
      form: {
        form_key: 'lab.unknown.application',
        version_id: randomUUID(),
        content_hash: `sha256:${'0'.repeat(64)}`,
      },
      data: {},
      locale: 'en-IN',
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body['error_code']).toBe('SF-SYS-002');
    const forged = await studioFetch(
      page,
      '/api/platform/metadata/documents',
      { kind: 'FORM', document_key: 'lab.forged.v1.0.0', payload: { pages: [] } },
      { 'Idempotency-Key': randomUUID(), 'x-tenant-id': randomUUID() },
    );
    expect(forged.status).toBe(403);
    expect(forged.body['error_code']).toBe('SF-TEN-002');
    const tampered = await studioFetch(
      page,
      '/api/platform/metadata/documents',
      {
        kind: 'FORM',
        document_key: `lab.tampered.v1.${randomInt(1, 9999)}.0`,
        payload: {
          pages: [{ id: 'applicant', fields: [{ id: 'name', control: 'text' }] }],
          form_package: {
            form_id: 'lab.tampered.application',
            json_schema: { type: 'object', properties: { name: { type: 'string' } } },
            ui_schema: { type: 'Categorization', elements: [] },
          },
          content_hash: `sha256:${'1'.repeat(64)}`,
        },
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(tampered.status).toBe(201);
    const validated = await studioFetch(
      page,
      `/api/platform/metadata/documents/${String(tampered.body['document_id'])}/validate`,
      {},
      { 'Idempotency-Key': randomUUID() },
    );
    expect(validated.status).toBe(400);
    expect(JSON.stringify(validated.body['details'])).toContain('/payload/content_hash');
  });
});
