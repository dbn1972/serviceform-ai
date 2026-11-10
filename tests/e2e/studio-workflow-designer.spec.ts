/**
 * Phase C-2 Studio workflow designer (SAMPLE_LAB): draw a canonical ServiceForm Workflow Model on
 * the canvas, check it and export/import BPMN through CMP-016 (interoperability profile only),
 * freeze it in CMP-033, emit a CMP-016 DRAFT and take the binding change through CMP-051
 * maker-checker. Temporal stays the runtime. Not CERTIFIED. G6 not issued. TSB seal not claimed.
 * REQ: Constitution §19, §33; DESIGN-SYSTEM.md rule 6 (axe, keyboard).
 */
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const STUDIO = 'http://127.0.0.1:3002';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ORG = '0d15ba00-0a01-4000-8000-0d15ba000a01';
const JURISDICTION = '0d15ba00-0a02-4000-8000-0d15ba000a02';
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

function view(page: Page, name: string) {
  return page.getByRole('tablist', { name: 'Designer views' }).getByRole('tab', { name });
}

async function studioPost(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      return {
        status: res.status,
        body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
      };
    },
    { path, body },
  );
}

test.describe('Studio workflow designer', () => {
  test('draw an officer-review flow on the canvas, check it with CMP-016 and export BPMN', async ({
    page,
  }) => {
    await signIn(page, 'sample-lab-studio-designer-1');
    await open(page, `${STUDIO}/workflows`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workflow designer');
    await expectAccessible(page);
    await page.getByRole('link', { name: 'New blank workflow' }).click();
    await page.getByLabel('Title', { exact: true }).fill('Trade licence case flow');
    await page.getByLabel('Workflow key').fill('lab.trade-licence.case-flow');

    await page.getByRole('button', { name: 'Start: Start (START)' }).click();
    await page.getByRole('button', { name: 'Delete path to END' }).click();
    await page.getByRole('button', { name: 'Add Officer task' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Scrutinise application');
    await page.getByLabel('Role code').fill('CASE_OFFICER');
    await page.getByLabel('Organisation id').fill(ORG);
    await page.getByLabel('Jurisdiction id').fill(JURISDICTION);
    await page.getByRole('button', { name: 'Add Choice' }).click();
    await page.getByLabel('Add a path to').selectOption('END');
    await page.getByRole('button', { name: 'Add path' }).click();
    await page.getByLabel('When outcome is').fill('RECORD_APPROVED');
    await page.getByRole('button', { name: /^Choice: Choice/ }).click();
    await page.getByRole('button', { name: 'Add End' }).click();
    await page.getByRole('button', { name: /^Choice: Choice/ }).click();
    await page.getByLabel('When outcome is').nth(1).fill('RECORD_REJECTED');
    await expect(page.getByRole('button', { name: 'No errors' })).toBeVisible();

    const task = page.getByRole('button', { name: /^Officer task: Scrutinise application/ });
    const before = await task.getAttribute('transform');
    await task.focus();
    await page.keyboard.press('ArrowDown');
    await expect(task).not.toHaveAttribute('transform', before ?? '');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(task).toHaveAttribute('transform', before ?? '');
    await expectAccessible(page);

    await view(page, 'Outline').click();
    await expect(page.getByRole('table')).toContainText('CASE_OFFICER');
    await expect(page.getByRole('table')).toContainText('RECORD_REJECTED');
    await view(page, 'Schema').click();
    const hash = (await page.getByTestId('workflow-graph-hash').textContent()) ?? '';
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    await view(page, 'BPMN').click();
    await page.getByRole('button', { name: 'Check with CMP-016 and export' }).click();
    await expect(page.getByTestId('workflow-cmp016-check')).toContainText('matches the designer');
    await expect(page.locator('pre[aria-label="BPMN XML"]')).toContainText('isExecutable="false"');
    await expectAccessible(page);
  });

  test('freeze, emit a CMP-016 draft and publish the binding change through maker-checker', async ({
    page,
  }) => {
    const tag = `${Date.now().toString(36)}${randomInt(1e3, 1e4)}`;
    await signIn(page, 'sample-lab-studio-designer-1');
    await open(page, `${STUDIO}/workflows/designer?template=case-sequencing`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Application case sequencing (commit-wait)',
    );
    await page.getByLabel('Workflow key').fill(`lab.e2e-${tag}.case-flow`);
    await view(page, 'Publish').click();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByTestId('workflow-document-status')).toHaveText('DRAFT');
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    await expect(page.getByTestId('workflow-document-status')).toHaveText('VALIDATED');
    await page.getByText('I understand this version becomes immutable.').click();
    await page.getByRole('button', { name: 'Freeze version' }).click();
    await expect(page.getByTestId('workflow-status')).toHaveText('FROZEN');
    await page.getByRole('button', { name: 'Emit CMP-016 draft' }).click();
    const emitted = page.getByTestId('workflow-cmp016-draft');
    await expect(emitted).toContainText('matches the frozen design');
    await expect(emitted).toContainText('DRAFT, STUDIO');
    const versionId = (await emitted.locator('code').first().textContent()) ?? '';

    const pins = Object.fromEntries(
      PIN_KINDS.map((k) => [
        k,
        {
          version_ref: `sample-lab-e2e.${k}.${tag}`,
          content_hash: `sha256:${createHash('sha256').update(`e2e:${k}:${tag}`).digest('hex')}`,
        },
      ]),
    );
    const base = await studioPost(page, '/api/platform/tenant-service-bindings', {
      binding_key: `ind-soc-002.wf-e2e-${tag}`,
      offering_ref: 'IND-SOC-002',
      metadata_bundle_ref: `sample-lab.e2e.${tag}`,
      pins,
    });
    expect(base.status).toBe(201);
    await page
      .getByLabel('TenantServiceBinding id to update')
      .fill(String(base.body['binding_id']));
    await page.getByRole('button', { name: 'Load binding' }).click();
    await expect(page.getByRole('row', { name: /workflow New/ })).toContainText(versionId);
    await page
      .getByLabel('Reason for the change (shown to the checker)')
      .fill('SAMPLE_LAB: case flow from the workflow designer (synthetic)');
    await page.getByRole('button', { name: 'Create binding draft and submit for review' }).click();
    const submitted = page.getByTestId('workflow-publication-request');
    await expect(submitted).toBeVisible();
    const requestId = (await submitted.locator('code').first().textContent()) ?? '';
    await expectAccessible(page);

    await signIn(page, 'sample-lab-studio-checker-1');
    await open(page, `${STUDIO}/publication?request=${requestId}`);
    await expect(page.getByTestId('publication-status')).toHaveText('SUBMITTED');
    const bpmnLink = page.getByRole('link', { name: /pinned workflow version as BPMN/ });
    const href = (await bpmnLink.getAttribute('href')) ?? '';
    expect(href).toContain(versionId);
    const xml = await page.evaluate(async (url) => (await fetch(url)).text(), href);
    expect(xml).toContain('isExecutable="false"');
    expect(xml).toContain('sf:runtime="TEMPORAL"');
    await page.getByLabel('Decision reason (recorded in the audit trail)').fill('Checked in lab');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('publication-status')).toHaveText('APPROVED');
    await page.getByRole('button', { name: 'Publish binding version' }).click();
    await expect(page.getByTestId('binding-published')).toBeVisible();
  });

  test('BPMN import is screened by CMP-016: named performers refused, profile documents accepted', async ({
    page,
  }) => {
    await signIn(page, 'sample-lab-studio-designer-1');
    await open(page, `${STUDIO}/workflows/designer?template=case-sequencing`);
    await view(page, 'BPMN').click();
    await page.getByRole('button', { name: 'Check with CMP-016 and export' }).click();
    await expect(page.getByTestId('workflow-cmp016-check')).toBeVisible();
    const exported =
      (await page.getByLabel('BPMN XML', { exact: true }).first().textContent()) ?? '';
    const named = exported.replace('sf:kind="WAIT"', 'sf:kind="WAIT" camunda:assignee="someone"');
    await page.getByRole('textbox', { name: 'BPMN XML' }).fill(named);
    await page.getByRole('button', { name: 'Import through CMP-016' }).click();
    await expect(
      page.getByText(/NAMED_OFFICER_FORBIDDEN|BPMN_RUNTIME_CONSTRUCT_FORBIDDEN/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Use the exported XML' }).click();
    await page.getByRole('button', { name: 'Import through CMP-016' }).click();
    await expect(page.getByText(/Imported 16 steps/)).toBeVisible();
    const refused = await studioPost(page, '/api/platform/workflow-drafts', {
      definition_key: `lab.tamper-${randomUUID().slice(0, 8)}.flow`,
      graph: {
        nodes: [
          { node_id: 'START', kind: 'START' },
          { node_id: 'END', kind: 'END' },
        ],
        edges: [{ from_node: 'START', to_node: 'END' }],
      },
      graph_hash: `sha256:${'0'.repeat(64)}`,
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('GRAPH_HASH_MISMATCH');
  });
});
