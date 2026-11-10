/**
 * Phase C-1 walkthrough screenshots of the Studio forms designer (SAMPLE_LAB). Not a test: run
 * against a running Studio (3002) and platform host (4000) to refresh UI evidence.
 *   OUT_DIR=/path node scripts/dev/capture-forms-designer.mjs
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const STUDIO = process.env.STUDIO_URL ?? 'http://127.0.0.1:3002';
const OUT = process.env.OUT_DIR ?? 'test-results/phase-c-studio';
const KINDS = [
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
];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const views = page.getByRole('tablist', { name: 'Designer views' });
const shot = async (name, opts = {}) => {
  // Full-page captures stitch the viewport; a sticky header would repeat mid-image.
  const unstick = opts.fullPage
    ? await page.addStyleTag({ content: '.sf-header { position: static; }' })
    : null;
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
  await unstick?.evaluate((el) => el.remove());
};
const signIn = async (subject) => {
  const res = await page.request.post(`${STUDIO}/api/session`, { data: { subject } });
  if (res.status() !== 201) throw new Error(`sign-in ${subject}: ${res.status()}`);
};

await page.goto(`${STUDIO}/forms`);
await page.waitForLoadState('networkidle');
await shot('01-forms-landing', { fullPage: true });

await signIn('sample-lab-studio-designer-1');
await page.goto(`${STUDIO}/forms/designer?template=ind-soc-002.residence-certificate&v=1.1.0`);
await page.waitForLoadState('networkidle');
await page.getByLabel('Version', { exact: true }).fill(`1.${randomInt(2, 9999)}.0`);
await shot('02-designer-canvas');

await page.getByRole('button', { name: 'Add Dropdown' }).click();
await page.getByLabel('Label', { exact: true }).fill('Type of residence');
await page.getByLabel('Data key').fill('residence_type');
await page.getByLabel('Option 1 label').fill('Owned');
await page.getByLabel('Option 1 stored value').fill('OWNED');
await page.getByLabel('Option 2 label').fill('Rented');
await page.getByLabel('Option 2 stored value').fill('RENTED');
await page.getByRole('button', { name: 'Add Short text' }).click();
await page.getByLabel('Label', { exact: true }).fill('Rent agreement number');
await page.getByLabel('Data key').fill('rent_agreement_no');
await page.getByText('Show or hide based on another answer').click();
await page.getByLabel('Answer to').selectOption('residence_type');
await page.getByLabel('Is', { exact: true }).selectOption('RENTED');
await page.getByLabel('Allowed characters').selectOption('upper_alnum');
await page.getByLabel('Try a value').fill('RA2026');
await shot('03-designer-inspector-rule-pattern');

await views.getByRole('tab', { name: 'Preview' }).click();
await page.getByLabel('Type of residence').selectOption('RENTED');
await shot('04-preview-desktop');
await page.getByRole('button', { name: 'Phone (360 px)' }).click();
await shot('05-preview-phone');

await views.getByRole('tab', { name: 'Schema' }).click();
await shot('06-schema');

await views.getByRole('tab', { name: 'Publish' }).click();
await page.getByRole('button', { name: 'Save draft' }).click();
await page.getByTestId('designer-document-status').filter({ hasText: 'DRAFT' }).waitFor();
await page.getByRole('button', { name: 'Validate', exact: true }).click();
await page.getByTestId('designer-document-status').filter({ hasText: 'VALIDATED' }).waitFor();
await page.getByText('I understand this version becomes immutable.').click();
await page.getByRole('button', { name: 'Freeze version' }).click();
await page.getByTestId('designer-status').filter({ hasText: 'FROZEN' }).waitFor();
await page.getByRole('button', { name: 'Resolve in CMP-009' }).click();
await page.getByTestId('designer-cmp009-result').waitFor();

const tag = `${Date.now().toString(36)}${randomInt(1e3, 1e4)}`;
const base = await page.evaluate(
  async ({ tag, kinds, hashes }) => {
    const res = await fetch('/api/platform/tenant-service-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        binding_key: `ind-soc-002.lab-${tag}`,
        offering_ref: 'IND-SOC-002',
        metadata_bundle_ref: `sample-lab.walkthrough.${tag}`,
        pins: Object.fromEntries(
          kinds.map((k, i) => [
            k,
            { version_ref: `sample-lab.${k}.${tag}`, content_hash: hashes[i] },
          ]),
        ),
      }),
    });
    return (await res.json()).binding_id;
  },
  {
    tag,
    kinds: KINDS,
    hashes: KINDS.map(
      (k) => `sha256:${createHash('sha256').update(`walkthrough:${k}:${tag}`).digest('hex')}`,
    ),
  },
);
await page.getByLabel('TenantServiceBinding id to update').fill(base);
await page.getByRole('button', { name: 'Load binding' }).click();
await page
  .getByLabel('Reason for the change (shown to the checker)')
  .fill('SAMPLE_LAB: add residence type and rent agreement number (synthetic)');
await page.getByRole('button', { name: 'Create binding draft and submit for review' }).click();
const submitted = page.getByTestId('designer-publication-request');
await submitted.waitFor();
const requestId = await submitted.locator('code').first().textContent();
await shot('07-publish-path', { fullPage: true });

await signIn('sample-lab-studio-checker-1');
await page.goto(`${STUDIO}/publication?request=${requestId}`);
await page.getByTestId('publication-status').filter({ hasText: 'SUBMITTED' }).waitFor();
await page
  .getByLabel('Decision reason (recorded in the audit trail)')
  .fill('Checked in SAMPLE_LAB');
await page.getByRole('button', { name: 'Approve' }).click();
await page.getByTestId('publication-status').filter({ hasText: 'APPROVED' }).waitFor();
await page.getByRole('button', { name: 'Publish binding version' }).click();
await page.getByTestId('binding-published').waitFor();
await shot('08-checker-approved-published', { fullPage: true });

await page.getByRole('link', { name: 'Inspect the pinned form (read-only)' }).click();
await page
  .getByText(/is frozen/)
  .first()
  .waitFor();
await shot('09-frozen-read-only');

await browser.close();
console.log(JSON.stringify({ out: OUT, request: requestId, base, id: randomUUID() }));
