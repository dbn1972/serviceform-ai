/**
 * Phase C-3 Studio rules designer (SAMPLE_LAB): author a GoRules (JDM) decision table in plain
 * language, run its test cases on the CMP-008 ZEN engine through the Studio test bench, freeze it
 * in CMP-033 and take the binding change through CMP-051 maker-checker. Rule outputs are advisory;
 * nothing here approves or rejects an application. Not CERTIFIED. G6 not issued. TSB seal not
 * claimed.
 * REQ: Constitution §20; DESIGN-SYSTEM.md rule 6 (axe, keyboard).
 */
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const STUDIO = 'http://127.0.0.1:3002';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
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

test.describe('Studio rules designer', () => {
  test('author a decision table, suggest boundary tests and run them on CMP-008', async ({
    page,
  }) => {
    await signIn(page, 'sample-lab-studio-designer-1');
    await open(page, `${STUDIO}/rules`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rules designer');
    await expectAccessible(page);
    await page.getByRole('link', { name: 'New blank rule pack' }).click();
    await page.getByLabel('Title', { exact: true }).fill('Trade licence fee band check');
    await page.getByLabel('Rule pack key').fill('lab.trade-licence.fee-band');

    await page.getByRole('button', { name: 'Edit input column Value' }).click();
    await page.getByLabel('Column label').fill('Annual turnover (lakh)');
    await page.getByLabel('Field', { exact: true }).fill('turnover_lakh');
    await page.getByRole('button', { name: 'Rule pack settings' }).click();
    await page.getByLabel('Add outcome code').fill('band_small');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByLabel('Add reason code').fill('TURNOVER_UNDER_LIMIT');
    await page.getByRole('button', { name: 'Add', exact: true }).nth(1).click();

    await page.getByRole('button', { name: 'Add row' }).click();
    await page.getByLabel('Description').fill('Small business');
    await page.getByLabel('Condition').selectOption('lt');
    await page.getByLabel('Number').fill('40');
    await page.getByLabel('Then Outcome').selectOption('BAND_SMALL');
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await inspector.getByText('TURNOVER_UNDER_LIMIT', { exact: true }).click();
    await expect(page.getByLabel('TURNOVER_UNDER_LIMIT')).toBeChecked();
    await page.getByRole('button', { name: 'Add row' }).click();
    await page.getByLabel('Description').fill('Otherwise an officer reviews');
    await page.getByLabel('Then Outcome').selectOption('REFER_TO_OFFICER');
    await expect(page.getByRole('table')).toContainText('less than 40');
    await expectAccessible(page);

    await view(page, 'Tests').click();
    await page.getByRole('button', { name: 'Suggest boundary tests' }).click();
    await expect(page.getByText('Added 3 boundary tests')).toBeVisible();
    await page.getByRole('button', { name: 'Run 3 on CMP-008' }).click();
    await expect(page.getByTestId('rules-test-summary')).toContainText('matches the designer');
    await expect(page.getByText('No expected result for 3 of 3 tests')).toBeVisible();

    for (const name of ['39 (suggested)', '40 (suggested)', '41 (suggested)']) {
      await page.getByRole('button', { name: `Annual turnover (lakh) = ${name}` }).click();
      await page.getByRole('button', { name: 'Use this result as expected' }).click();
    }
    await page.getByRole('button', { name: 'Run 3 on CMP-008' }).click();
    await expect(page.getByText('All 3 tests passed')).toBeVisible();
    const row39 = page.getByRole('row', { name: /= 39 \(suggested\)/ });
    await expect(row39).toContainText('BAND_SMALL');
    await expect(page.getByRole('row', { name: /= 40 \(suggested\)/ })).toContainText(
      'REFER_TO_OFFICER',
    );
    await expectAccessible(page);

    await view(page, 'JDM').click();
    const hash = (await page.getByTestId('rules-content-hash').textContent()) ?? '';
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(page.getByLabel('JDM JSON')).toContainText('"hitPolicy": "first"');
    await expect(page.getByLabel('JDM JSON')).toContainText('"< 40"');
  });

  test('freeze a tested pack and publish the binding change through maker-checker', async ({
    page,
  }) => {
    const tag = `${Date.now().toString(36)}${randomInt(1e3, 1e4)}`;
    await signIn(page, 'sample-lab-studio-designer-1');
    await open(page, `${STUDIO}/rules/designer?template=residence-period`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Residence period indicative check',
    );
    await page.getByLabel('Rule pack key').fill(`lab.e2e-${tag}.residence-period`);
    await view(page, 'Publish').click();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByTestId('rules-document-status')).toHaveText('DRAFT');
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    await expect(page.getByTestId('rules-document-status')).toHaveText('VALIDATED');
    await expect(page.getByRole('button', { name: 'Freeze version' })).toBeDisabled();
    await page.getByRole('button', { name: 'Run tests on CMP-008' }).click();
    await expect(page.getByTestId('rules-publish-tests')).toHaveText(
      'All 3 tests pass for this content_hash.',
    );
    await page.getByText('I understand this version becomes immutable.').click();
    await page.getByRole('button', { name: 'Freeze version' }).click();
    await expect(page.getByTestId('rules-status')).toHaveText('FROZEN');
    const documentId = (await page.getByTestId('rules-document-id').textContent()) ?? '';

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
      binding_key: `ind-soc-002.rules-e2e-${tag}`,
      offering_ref: 'IND-SOC-002',
      metadata_bundle_ref: `sample-lab.e2e.${tag}`,
      pins,
    });
    expect(base.status).toBe(201);
    await page
      .getByLabel('TenantServiceBinding id to update')
      .fill(String(base.body['binding_id']));
    await page.getByRole('button', { name: 'Load binding' }).click();
    await expect(page.getByRole('row', { name: /rules New/ })).toContainText(documentId);
    await page
      .getByLabel('Reason for the change (shown to the checker)')
      .fill('SAMPLE_LAB: residence period check from the rules designer (synthetic)');
    await page.getByRole('button', { name: 'Create binding draft and submit for review' }).click();
    const submitted = page.getByTestId('rules-publication-request');
    await expect(submitted).toBeVisible();
    const requestId = (await submitted.locator('code').first().textContent()) ?? '';
    await expectAccessible(page);

    await signIn(page, 'sample-lab-studio-checker-1');
    await open(page, `${STUDIO}/publication?request=${requestId}`);
    await expect(page.getByTestId('publication-status')).toHaveText('SUBMITTED');
    const inspect = page.getByRole('link', { name: /pinned rule pack and its tests/ });
    await expect(inspect).toHaveAttribute('href', `/rules/designer?document=${documentId}`);
    await page.getByLabel('Decision reason (recorded in the audit trail)').fill('Checked in lab');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('publication-status')).toHaveText('APPROVED');
    await page.getByRole('button', { name: 'Publish binding version' }).click();
    await expect(page.getByTestId('binding-published')).toBeVisible();

    await inspect.click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('rules-status')).toHaveText('FROZEN');
    await expect(page.getByRole('button', { name: 'Add row' })).toBeDisabled();
    await expectAccessible(page);
    await view(page, 'Tests').click();
    await page.getByRole('button', { name: 'Run 3 on CMP-008' }).click();
    await expect(page.getByText('All 3 tests passed')).toBeVisible();
    await expectAccessible(page);
  });

  test('the test bench is OPA-authorised and refuses packs CMP-008 would refuse', async ({
    page,
  }) => {
    await signIn(page, 'sample-lab-studio-designer-1');
    await open(page, `${STUDIO}/rules/designer?template=residence-period`);
    const clock = await studioPost(page, '/api/platform/rule-packs/test', {
      pack: {
        rule_pack_id: 'lab.clock-check',
        engine: 'GORULES',
        jdm: {
          contentType: 'application/vnd.gorules.decision',
          nodes: [
            { id: 'in', type: 'inputNode', name: 'In', position: { x: 0, y: 0 } },
            {
              id: 'expr',
              type: 'expressionNode',
              name: 'Clock',
              position: { x: 1, y: 0 },
              content: { expressions: [{ id: 'e', key: 'outcome', value: 'now()' }] },
            },
            { id: 'out', type: 'outputNode', name: 'Out', position: { x: 2, y: 0 } },
          ],
          edges: [
            { id: 'a', sourceId: 'in', targetId: 'expr', type: 'edge' },
            { id: 'b', sourceId: 'expr', targetId: 'out', type: 'edge' },
          ],
        },
      },
      cases: [{ inputs: {} }],
    });
    expect(clock.status).toBe(422);
    expect(JSON.stringify(clock.body)).toContain('JDM_NON_DETERMINISTIC_FUNCTION');

    await signIn(page, 'sample-lab-case-officer-1');
    const denied = await studioPost(page, '/api/platform/rule-packs/test', {
      pack: { rule_pack_id: 'lab.x', engine: 'GORULES', jdm: {} },
      cases: [],
    });
    expect(denied.status).toBe(403);
  });
});
