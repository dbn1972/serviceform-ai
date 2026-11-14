/**
 * Phase C-2 walkthrough screenshots of the Studio workflow designer (SAMPLE_LAB). Not a test: run
 * against a running Studio (3002) and platform host (4000) to refresh UI evidence.
 *   OUT_DIR=/path node scripts/dev/capture-workflow-designer.mjs
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

await signIn('sample-lab-studio-designer-1');
await page.goto(`${STUDIO}/workflows`);
await page.waitForLoadState('networkidle');
await shot('01-workflows-landing', { fullPage: true });

await page.goto(`${STUDIO}/workflows/designer`);
await page.waitForLoadState('networkidle');
await page.getByLabel('Title', { exact: true }).fill('Trade licence case flow');
await page.getByLabel('Workflow key').fill(`lab.trade-licence-${randomInt(1e3, 1e4)}.case-flow`);
await page.getByRole('button', { name: 'Start: Start (START)' }).click();
await page.getByRole('button', { name: 'Delete path to END' }).click();
await page.getByRole('button', { name: 'Add Officer task' }).click();
await page.getByLabel('Label', { exact: true }).fill('Scrutinise application');
await page.getByLabel('Role code').fill('CASE_OFFICER');
await page.getByLabel('Organisation id').fill('0d15ba00-0a01-4000-8000-0d15ba000a01');
await page.getByLabel('Jurisdiction id').fill('0d15ba00-0a02-4000-8000-0d15ba000a02');
await page.getByRole('button', { name: 'Add Rule check' }).click();
await page.getByLabel('Label', { exact: true }).fill('Residence period check');
await page.getByRole('button', { name: 'Add Choice' }).click();
await page.getByLabel('Add a path to').selectOption('END');
await page.getByRole('button', { name: 'Add path' }).click();
await page.getByLabel('When outcome is').fill('RECORD_APPROVED');
await page.getByRole('button', { name: /^Choice: Choice/ }).click();
await page.getByRole('button', { name: 'Add End' }).click();
await page.getByRole('button', { name: /^Choice: Choice/ }).click();
await page.getByLabel('When outcome is').nth(1).fill('RECORD_REJECTED');
await page.getByRole('button', { name: /^Rule check: Residence period check/ }).click();
await page.getByLabel('Rule decision ref').fill('ind-soc-002.residence:eligibility');
await page.getByRole('button', { name: 'Tidy layout' }).click();
for (let i = 0; i < 2; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
await page.getByRole('button', { name: /^Officer task: Scrutinise application/ }).click();
await shot('02-canvas-officer-task');

await views.getByRole('tab', { name: 'Outline' }).click();
await shot('03-outline');

await views.getByRole('tab', { name: 'BPMN' }).click();
await page.getByRole('button', { name: 'Check with CMP-016 and export' }).click();
await page.getByTestId('workflow-cmp016-check').waitFor();
await shot('04-bpmn-export');

await page.goto(`${STUDIO}/workflows/designer?template=case-sequencing`);
await page.waitForLoadState('networkidle');
const tag = `${Date.now().toString(36)}${randomInt(1e3, 1e4)}`;
await page.getByLabel('Workflow key').fill(`lab.walkthrough-${tag}.case-flow`);
for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
await page
  .getByRole('button', { name: 'Wait for case step: Wait under scrutiny (WAIT_UNDER_SCRUTINY)' })
  .click();
await shot('05-template-canvas');

await views.getByRole('tab', { name: 'Publish' }).click();
await page.getByRole('button', { name: 'Save draft' }).click();
await page.getByTestId('workflow-document-status').filter({ hasText: 'DRAFT' }).waitFor();
await page.getByRole('button', { name: 'Validate', exact: true }).click();
await page.getByTestId('workflow-document-status').filter({ hasText: 'VALIDATED' }).waitFor();
await page.getByText('I understand this version becomes immutable.').click();
await page.getByRole('button', { name: 'Freeze version' }).click();
await page.getByTestId('workflow-status').filter({ hasText: 'FROZEN' }).waitFor();
await page.getByRole('button', { name: 'Emit CMP-016 draft' }).click();
await page.getByTestId('workflow-cmp016-draft').waitFor();
const base = await page.evaluate(
  async ({ tag, kinds, hashes }) => {
    const res = await fetch('/api/platform/tenant-service-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        binding_key: `ind-soc-002.wf-lab-${tag}`,
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
  .fill('SAMPLE_LAB: case flow from the workflow designer (synthetic)');
await page.getByRole('button', { name: 'Create binding draft and submit for review' }).click();
const submitted = page.getByTestId('workflow-publication-request');
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

await browser.close();
console.log(JSON.stringify({ out: OUT, request: requestId, base }));
