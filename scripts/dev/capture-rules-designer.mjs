/**
 * Phase C-3 walkthrough screenshots of the Studio rules designer (SAMPLE_LAB). Not a test: run
 * against a running Studio (3002) and platform host (4000) to refresh UI evidence.
 *   OUT_DIR=/path node scripts/dev/capture-rules-designer.mjs
 */
import { createHash, randomInt } from 'node:crypto';
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
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1000 } })
).newPage();
const views = page.getByRole('tablist', { name: 'Designer views' });
const shot = async (name, opts = {}) => {
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
const inspector = page.getByRole('complementary', { name: 'Inspector' });

await signIn('sample-lab-studio-designer-1');
await page.goto(`${STUDIO}/rules`);
await page.waitForLoadState('networkidle');
await shot('01-rules-landing', { fullPage: true });

await page.goto(`${STUDIO}/rules/designer`);
await page.waitForLoadState('networkidle');
await page.getByLabel('Title', { exact: true }).fill('Trade licence fee band check');
await page.getByLabel('Rule pack key').fill(`lab.trade-licence-${randomInt(1e3, 1e4)}.fee-band`);
await page.getByRole('button', { name: 'Edit input column Value' }).click();
await page.getByLabel('Column label').fill('Annual turnover (lakh)');
await page.getByLabel('Field', { exact: true }).fill('turnover_lakh');
await page.getByRole('button', { name: 'Add input' }).click();
await page.getByLabel('Column label').fill('Premises in a market area');
await page.getByLabel('Field', { exact: true }).fill('premises.in_market_area');
await page.getByLabel('Value type').selectOption('boolean');
await page.getByRole('button', { name: 'Rule pack settings' }).click();
for (const code of ['BAND_SMALL', 'BAND_MARKET']) {
  await page.getByLabel('Add outcome code').fill(code);
  await page.getByLabel('Add outcome code').press('Enter');
}
for (const code of ['TURNOVER_UNDER_LIMIT', 'MARKET_AREA']) {
  await page.getByLabel('Add reason code').fill(code);
  await page.getByLabel('Add reason code').press('Enter');
}
await page.getByRole('button', { name: 'Add row' }).click();
await page.getByLabel('Description').fill('Market-area premises');
await page.getByLabel('Condition').nth(1).selectOption('eq');
await page.getByLabel('Then Outcome').selectOption('BAND_MARKET');
await inspector.getByText('MARKET_AREA', { exact: true }).click();
await page.getByRole('button', { name: 'Add row' }).click();
await page.getByLabel('Description').fill('Small business');
await page.getByLabel('Condition').first().selectOption('lt');
await page.getByLabel('Number').fill('40');
await page.getByLabel('Then Outcome').selectOption('BAND_SMALL');
await inspector.getByText('TURNOVER_UNDER_LIMIT', { exact: true }).click();
await page.getByRole('button', { name: 'Add row' }).click();
await page.getByLabel('Description').fill('Otherwise an officer reviews');
await page.getByLabel('Then Outcome').selectOption('REFER_TO_OFFICER');
await page.getByRole('button', { name: 'Edit row 2: Small business' }).click();
await shot('02-decision-table');

await views.getByRole('tab', { name: 'Tests' }).click();
await page.getByRole('button', { name: 'Suggest boundary tests' }).click();
await page.getByRole('button', { name: /^Run \d+ on CMP-008$/ }).click();
await page.getByTestId('rules-test-summary').waitFor();
await page.getByRole('button', { name: 'Annual turnover (lakh) = 39 (suggested)' }).click();
await shot('03-tests-unchecked');
for (const v of ['39', '40', '41']) {
  await page.getByRole('button', { name: `Annual turnover (lakh) = ${v} (suggested)` }).click();
  await page.getByRole('button', { name: 'Use this result as expected' }).click();
}
const runButton = page.getByRole('button', { name: /^Run \d+ on CMP-008$/ });
await runButton.click();
await page.getByText('All 3 tests passed').waitFor();
await runButton.and(page.locator(':enabled')).waitFor();
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await shot('04-tests-passed');

await views.getByRole('tab', { name: 'JDM' }).click();
await shot('05-jdm');

await page.goto(`${STUDIO}/rules/designer?template=residence-period`);
await page.waitForLoadState('networkidle');
const tag = `${Date.now().toString(36)}${randomInt(1e3, 1e4)}`;
await page.getByLabel('Rule pack key').fill(`lab.walkthrough-${tag}.residence-period`);
await views.getByRole('tab', { name: 'Publish' }).click();
await page.getByRole('button', { name: 'Save draft' }).click();
await page.getByTestId('rules-document-status').filter({ hasText: 'DRAFT' }).waitFor();
await page.getByRole('button', { name: 'Validate', exact: true }).click();
await page.getByTestId('rules-document-status').filter({ hasText: 'VALIDATED' }).waitFor();
await page.getByRole('button', { name: 'Run tests on CMP-008' }).click();
await page.getByText('All 3 tests pass for this content_hash.').waitFor();
await page.getByText('I understand this version becomes immutable.').click();
await page.getByRole('button', { name: 'Freeze version' }).click();
await page.getByTestId('rules-status').filter({ hasText: 'FROZEN' }).waitFor();
const base = await page.evaluate(
  async ({ tag, kinds, hashes }) => {
    const res = await fetch('/api/platform/tenant-service-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        binding_key: `ind-soc-002.rules-lab-${tag}`,
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
  .fill('SAMPLE_LAB: residence period check from the rules designer (synthetic)');
await page.getByRole('button', { name: 'Create binding draft and submit for review' }).click();
const submitted = page.getByTestId('rules-publication-request');
await submitted.waitFor();
const requestId = await submitted.locator('code').first().textContent();
await shot('06-publish-path', { fullPage: true });

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
await shot('07-checker-published', { fullPage: true });

await page.getByRole('link', { name: /pinned rule pack and its tests/ }).click();
await page.waitForLoadState('networkidle');
await page.getByTestId('rules-status').filter({ hasText: 'FROZEN' }).waitFor();
await page.waitForTimeout(400);
await shot('08-checker-reads-frozen-pack');

await browser.close();
console.log(JSON.stringify({ out: OUT, request: requestId, base }));
